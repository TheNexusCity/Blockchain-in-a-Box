const path = require("path");
const http = require("http");
const bip39 = require("bip39");
const { hdkey } = require("ethereumjs-wallet");
const {
  getBlockchain,
  areAddressesCollaborator,
} = require("@blockchain-in-a-box/common/src/blockchain.js");
const {
  makePromise,
  setCorsHeaders,
} = require("@blockchain-in-a-box/common/src/utils.js");
const {
  getRedisItem,
  parseRedisItems,
  getRedisClient,
} = require("@blockchain-in-a-box/common/src/redis.js");
const {
  proofOfAddressMessage,
  unlockableMetadataKey,
  encryptedMetadataKey,
  redisPrefixes,
  mainnetSignatureMessage,
  nftIndexName,
  burnAddress,
  zeroAddress,
} = require("@blockchain-in-a-box/common/src/constants.js");
const { ResponseStatus } = require("../enums.js");
const {
  runSidechainTransaction,
} = require("@blockchain-in-a-box/common/src/tokens.js");
const {
  PRODUCTION,
  DEVELOPMENT,
  PINATA_API_KEY,
  PINATA_SECRET_API_KEY,
  MINTING_FEE,
  DEFAULT_TOKEN_DESCRIPTION,
  IPFS_HOST,
  ENCRYPTION_MNEMONIC,
  MAINNET_MNEMONIC,
} = require("@blockchain-in-a-box/common/src/environment.js");

const { jsonParse } = require("@blockchain-in-a-box/common/src/utils.js");

const {
  encodeSecret,
  decodeSecret,
} = require("@blockchain-in-a-box/common/src/encryption.js");

const pinataSDK = require("@pinata/sdk");
const pinata =
  PINATA_API_KEY && PINATA_API_KEY !== ""
    ? pinataSDK(PINATA_API_KEY, PINATA_SECRET_API_KEY)
    : null;

const pinataOptions = {
  pinataOptions: {
    customPinPolicy: {
      regions: [
        {
          id: "FRA1",
          desiredReplicationCount: 1,
        },
        {
          id: "NYC1",
          desiredReplicationCount: 2,
        },
      ],
    },
  },
};

const redisClient = getRedisClient();

const network = PRODUCTION ? "mainnet" : "testnet";

const { Readable } = require("stream");

let web3, contracts;

(async function () {
  const blockchain = await getBlockchain();
  web3 = blockchain.web3;
  contracts = blockchain.contracts;
})();

// Takes an account as input
async function listTokens(req, res, web3) {
  const { address, mainnetAddress } = req.params;

  if (DEVELOPMENT) setCorsHeaders(res);
  try {
    const [mainnetTokens, sidechainTokens] = await Promise.all([
      (async () => {
        if (!mainnetAddress) return [];
        const recoveredAddress = await web3[network].eth.accounts.recover(
          mainnetSignatureMessage,
          mainnetAddress
        );
        if (!recoveredAddress) return [];
        const p = makePromise();
        const args = `${nftIndexName} ${JSON.stringify(
          recoveredAddress
        )} INFIELDS 1 currentOwnerAddress LIMIT 0 1000000`
          .split(" ")
          .concat([
            (err, result) => {
              if (!err) {
                const items = parseRedisItems(result);
                p.accept({
                  Items: items,
                });
              } else {
                p.reject(err);
              }
            },
          ]);
        redisClient.ft_search.apply(redisClient, args);
        const o = await p;

        return (o && o.Items) || [];
      })(),
      (async () => {
        const p = makePromise();
        const args = `${nftIndexName} ${JSON.stringify(
          address
        )} INFIELDS 1 currentOwnerAddress LIMIT 0 1000000`
          .split(" ")
          .concat([
            (err, result) => {
              if (!err) {
                const items = parseRedisItems(result);
                p.accept({
                  Items: items,
                });
              } else {
                p.reject(err);
              }
            },
          ]);
        redisClient.ft_search.apply(redisClient, args);
        const o = await p;
        return (o && o.Items) || [];
      })(),
    ]);
    const tokens = sidechainTokens
      .concat(mainnetTokens)
      .sort((a, b) => a.id - b.id)
      .filter((token, i) => {
        // filter unique hashes
        if (
          token === "0" ||
          (token.properties.hash === "" && token.owner.address === zeroAddress)
        )
          return false;

        for (let j = 0; j < i; j++) {
          if (
            tokens[j].properties.hash === token.properties.hash &&
            token.properties.hash !== ""
          )
            return false;
        }
        return true;
      });
    return res.json({
      status: ResponseStatus.Success,
      tokens: JSON.stringify(tokens),
      error: null,
    });
  } catch (error) {
    return res.json({ status: ResponseStatus.Error, tokens: null, error });
  }
}

// Called by create token on successful resource upload
async function mintTokens(
  resHash,
  mnemonic,
  quantity,
  privateData,
  web3,
  contracts,
  res
) {
  let tokenIds, status;
  const fullAmount = {
    t: "uint256",
    v: new web3.utils.BN(1e9)
      .mul(new web3.utils.BN(1e9))
      .mul(new web3.utils.BN(1e9)),
  };

  const fullAmountD2 = {
    t: "uint256",
    v: fullAmount.v.div(new web3.utils.BN(2)),
  };
  const wallet = hdkey
    .fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic))
    .derivePath(`m/44'/60'/0'/0/0`)
    .getWallet();
  const address = wallet.getAddressString();

  if (MINTING_FEE > 0) {
    let allowance = await contracts["FT"].methods
      .allowance(address, contracts["NFT"]._address)
      .call();
    allowance = new web3.utils.BN(allowance, 0);
    if (allowance.lt(fullAmountD2.v)) {
      const result = await runSidechainTransaction(mnemonic)(
        "FT",
        "approve",
        contracts["NFT"]._address,
        fullAmount.v
      );
      status = result.status;
    } else {
      status = true;
    }
  } else status = true;

  if (status) {
    const description = DEFAULT_TOKEN_DESCRIPTION;

    let fileName = resHash.split("/").pop();

    let extName = path.extname(fileName).slice(1);
    extName = extName === "" ? "png" : extName;
    extName = extName === "jpeg" ? "jpg" : extName;

    fileName = extName ? fileName.slice(0, -(extName.length + 1)) : fileName;

    const { hash } = JSON.parse(Buffer.from(resHash, "utf8").toString("utf8"));

    const result = await runSidechainTransaction(mnemonic)(
      "NFT",
      "mint",
      address,
      hash,
      fileName,
      extName,
      description,
      quantity
    );
    status = result.status;

    if (privateData) {
      const encryptedData = encodeSecret(privateData);
      await runSidechainTransaction(mnemonic)(
        "NFT",
        "setMetadata",
        hash,
        unlockableMetadataKey,
        encryptedData
      );
      await runSidechainTransaction(mnemonic)(
        "NFT",
        "setMetadata",
        hash,
        encryptedMetadataKey,
        encryptedData
      );
    }

    const tokenId = new web3.utils.BN(
      result.logs[0].topics[3].slice(2),
      16
    ).toNumber();
    tokenIds = [tokenId, tokenId + quantity - 1];
  }
  return res.json({ status: ResponseStatus.Success, tokenIds, error: null });
}

async function createToken(req, res, { web3, contracts }) {
  const { mnemonic, quantity, privateData } = req.body;

  try {
    let { resourceHash } = req.body;

    const file = req.files && req.files[0];

    if (!bip39.validateMnemonic(mnemonic)) {
      return res.json({
        status: ResponseStatus.Error,
        error: "Invalid mnemonic",
      });
    }

    if (!resourceHash && !file) {
      return res.json({
        status: ResponseStatus.Error,
        error: "POST did not include a file or resourceHash",
      });
    }

    // Check if there are any files -- if there aren't, check if there's a hash
    if (resourceHash && file) {
      return res.json({
        status: ResponseStatus.Error,
        error: "POST should include a resourceHash *or* file but not both",
      });
    }

    if (file) {
      const readableStream = new Readable({
        read() {
          this.push(Buffer.from(file));
          this.push(null);
        },
      });
        const { IpfsHash } = pinata.pinFileToIPFS(
          readableStream,
          pinataOptions
        );
        if (IpfsHash)
          mintTokens(IpfsHash, mnemonic, quantity, web3, contracts, res);
        else
          res.json({
            status: ResponseStatus.Error,
            error: "Error pinning to Pinata service, hash was not returned",
          });
    } else {
      mintTokens(
        resourceHash,
        mnemonic,
        quantity,
        privateData,
        web3,
        contracts,
        res
      );
    }
  } catch (error) {
    console.warn(error.stack);
    return res.json({ status: ResponseStatus.Error, tokenIds: [], error });
  }
}

async function readToken(req, res) {
  const { tokenId } = req.params;
  let o = await getRedisItem(tokenId, redisPrefixes.mainnetsidechainNft);
  let token = o.Item;

  if (DEVELOPMENT) setCorsHeaders(res);
  if (token) {
    return res.json({ status: ResponseStatus.Success, token, error: null });
  } else {
    return res.json({
      status: ResponseStatus.Error,
      token: null,
      error: "The token could not be found",
    });
  }
}

// Same as read token, but return unlockable in plaintext
async function readTokenWithUnlockable(req, res) {
  const { tokenId } = req.params;
  let o = await getRedisItem(tokenId, redisPrefixes.mainnetsidechainNft);
  let token = o.Item;

  if (DEVELOPMENT) setCorsHeaders(res);
  if (token) {
    if (
      token[unlockableMetadataKey] !== undefined &&
      token[unlockableMetadataKey] !== ""
    ) {
      let value = token[unlockableMetadataKey];
      value = jsonParse(value);
      if (value !== null) {
        let { ciphertext, tag } = value;
        ciphertext = Buffer.from(ciphertext, "base64");
        tag = Buffer.from(tag, "base64");
        value = decodeSecret(ENCRYPTION_MNEMONIC, { ciphertext, tag });
      }
      token[unlockableMetadataKey] = value;
    }
    return res.json({ status: ResponseStatus.Success, token, error: null });
  } else {
    return res.json({
      status: ResponseStatus.Error,
      token: null,
      error: "The token could not be found",
    });
  }
}

// async function readUnlockable(req, res) {
//     const {tokenId} = req.params;
//     let o = await getRedisItem(tokenId, redisPrefixes.mainnetsidechainNft);
//     let token = o.Item;
//     let value = "";
//     if (DEVELOPMENT) setCorsHeaders(res);
//     if (token) {
//         if(token[unlockableMetadataKey] !== undefined && token[unlockableMetadataKey] !== ""){
//             value = token[unlockableMetadataKey];
//             value = jsonParse(value);
//             if (value !== null) {
//               let {ciphertext, tag} = value;
//               ciphertext = Buffer.from(ciphertext, 'base64');
//               tag = Buffer.from(tag, 'base64');
//               value = decodeSecret(ENCRYPTION_MNEMONIC, {ciphertext, tag});
//             }
//             token[unlockableMetadataKey] = value;
//             return res.json({status: ResponseStatus.Success, value, error: null})
//         } else {
//             return res.json({status: ResponseStatus.Error, value: null, error: "The token could not be unlocked"})
//         }
//     } else {
//         return res.json({status: ResponseStatus.Error, value: null, error: "The token could not be found"})
//     }
// }

// async function readEncryptedData(req, res) {
//     const {tokenId} = req.params;
//     let o = await getRedisItem(tokenId, redisPrefixes.mainnetsidechainNft);
//     let token = o.Item;
//     if (DEVELOPMENT) setCorsHeaders(res);
//     if (token) {
//         if(token[encryptedMetadataKey] !== undefined && token[encryptedMetadataKey] !== ""){
//             const url = token[encryptedMetadataKey];
//             await fetch(url).then(data => res.send(data));
//         } else {
//             return res.json({status: ResponseStatus.Error, value: null, error: "The token does not appear to have encrypted data"})
//         }
//     } else {
//         return res.json({status: ResponseStatus.Error, value: null, error: "The token could not be found"})
//     }
// }

async function readTokenRange(req, res) {
  if (DEVELOPMENT) setCorsHeaders(res);
  try {
    const { tokenStartId, tokenEndId } = req.params;

    if (
      tokenStartId <= 0 ||
      tokenEndId < tokenStartId ||
      tokenEndId - tokenStartId > 100
    )
      return res.json({
        status: ResponseStatus.Error,
        error: "Invalid range for tokens",
      });

    const promise = makePromise();
    const args =
      `${nftIndexName} * filter id ${tokenStartId} ${tokenEndId} LIMIT 0 1000000`
        .split(" ")
        .concat([
          (err, result) => {
            if (!err) {
              const items = parseRedisItems(result);
              promise.accept({
                Items: items,
              });
            } else {
              promise.reject(err);
            }
          },
        ]);
    redisClient.ft_search.apply(redisClient, args);
    const o = await promise;

    let tokens = o.Items.filter((token) => token !== null)
      .sort((a, b) => a.id - b.id)
      .filter((token, i) => {
        // filter unique hashes

        if (token.properties.hash === "" && token.owner.address === zeroAddress)
          return false;

        for (let j = 0; j < i; j++)
          if (
            tokens[j].properties.hash === token.properties.hash &&
            token.properties.hash !== ""
          )
            return false;

        return true;
      });

    return res.json({ status: ResponseStatus.Success, tokens, error: null });
  } catch (error) {
    return res.json({ status: ResponseStatus.Error, tokens: [], error });
  }
}

// TODO: Try to unpin from pinata if we are using pinata
async function deleteToken(req, res) {
  try {
    const { tokenId } = req.body;

    let o = await getRedisItem(tokenId, redisPrefixes.mainnetsidechainNft);
    let token = o.Item;

    const address = token.owner.address;

    const currentHash = await contracts["mainnetsidechain"].NFT.methods
      .getHash(tokenId)
      .call();
    const randomHash = Math.random().toString(36);
    await runSidechainTransaction(MAINNET_MNEMONIC)(
      "NFT",
      "updateHash",
      currentHash,
      randomHash
    );
    const result = await runSidechainTransaction(MAINNET_MNEMONIC)(
      "NFT",
      "transferFrom",
      address,
      burnAddress,
      tokenId
    );

    if (result) console.log("Result of delete transaction:", result);
    return res.json({ status: ResponseStatus.Success, error: null });
  } catch (error) {
    return res.json({ status: ResponseStatus.Error, error });
  }
}

async function sendToken(req, res) {
  try {
    const { fromUserAddress, toUserAddress, tokenId } = req.body;
    const quantity = req.body.quantity ?? 1;

    let status = true;
    let error = null;
    for (let i = 0; i < quantity; i++) {
      try {
        const isApproved = await contracts.NFT.methods
          .isApprovedForAll(fromUserAddress, contracts["Trade"]._address)
          .call();
        if (!isApproved) {
          await runSidechainTransaction(MAINNET_MNEMONIC)(
            "NFT",
            "setApprovalForAll",
            contracts["Trade"]._address,
            true
          );
        }

        const result = await runSidechainTransaction(MAINNET_MNEMONIC)(
          "NFT",
          "transferFrom",
          fromUserAddress,
          toUserAddress,
          tokenId
        );
        status = status && result.status;
      } catch (err) {
        console.warn(err.stack);
        status = false;
        error = err;
        break;
      }
    }

    if (status) {
      return res.json({
        status: ResponseStatus.Success,
        message: "Transferred " + tokenId + " to " + toUserAddress,
        error: null,
      });
    } else {
      return res.json({
        status: ResponseStatus.Error,
        message: "Transfer request could not be fulfilled: " + status,
        error: error,
      });
    }
  } catch (error) {
    return res.json({
      status: ResponseStatus.Error,
      message: "Error sending token",
      error: error,
    });
  }
}

async function signTransfer(req, res, blockchain) {
  console.warn("Method not implemented", req, res, blockchain);
}

async function getPrivateData(req, res) {
  const { signatures, id } = req.body;
  const key = unlockableMetadataKey;
  const addresses = [];
  let unlockSuccessful = false;
  for (const signature of signatures) {
    try {
      let address = await web3.mainnetsidechain.eth.accounts.recover(
        proofOfAddressMessage,
        signature
      );
      address = address.toLowerCase();
      addresses.push(address);
      unlockSuccessful = true;
    } catch (err) {
      console.warn(err.stack);
      unlockSuccessful = false;
    }
  }

  if (!unlockSuccessful)
    return res.json({
      status: ResponseStatus.error,
      error: "Failed to unlock private token data",
    });

  const hash = await contracts.mainnetsidechain.NFT.methods.getHash(id).call();
  const isCollaborator = await areAddressesCollaborator(addresses, hash, id);
  if (isCollaborator) {
    let value = await contracts.mainnetsidechain.NFT.methods
      .getMetadata(hash, key)
      .call();
    value = jsonParse(value);
    if (value !== null) {
      let { ciphertext, tag } = value;
      ciphertext = Buffer.from(ciphertext, "base64");
      tag = Buffer.from(tag, "base64");
      value = decodeSecret(ENCRYPTION_MNEMONIC, { ciphertext, tag });
    }
    return res.json({
      status: ResponseStatus.success,
      payload: value,
      error: null,
    });
  } else {
    return res.json({
      status: ResponseStatus.error,
      payload: null,
      error: `Address is not a collaborator on ${hash}`,
    });
  }
}

// TODO: Try to unpin from pinata if we are using pinata and already have file
async function updatePublicAsset(req, res, { contracts }) {
  const { mnemonic, tokenId, resourceHash } = req.body;
  const file = req.files && req.files[0];
  try {
    if (!bip39.validateMnemonic(mnemonic)) {
      return res.json({
        status: ResponseStatus.Error,
        error: "Invalid mnemonic",
      });
    }

    if (!resourceHash && !file) {
      return res.json({
        status: ResponseStatus.Error,
        error: "POST did not include a file or resourceHash",
      });
    }

    // Check if there are any files -- if there aren't, check if there's a hash
    if (resourceHash && file) {
      return res.json({
        status: ResponseStatus.Error,
        error: "POST should include a resourceHash *or* file but not both",
      });
    }

    if (file) {
      const readableStream = new Readable({
        read() {
          this.push(Buffer.from(file));
          this.push(null);
        },
      });

      // Pinata API keys are valid, so this is probably what the user wants
      if (pinata) {
        // TODO: Try to unpin existing pinata hash
        const { IpfsHash } = pinata.pinFileToIPFS(
          readableStream,
          pinataOptions
        );
        if (IpfsHash) {
          const currentHash = await contracts["mainnetsidechain"].NFT.methods
            .getHash(tokenId)
            .call();
          await runSidechainTransaction(MAINNET_MNEMONIC)(
            "NFT",
            "updateHash",
            currentHash,
            IpfsHash
          );
        } else
          res.json({
            status: ResponseStatus.Error,
            error: "Error pinning to Pinata service, hash was not returned",
          });
      } else {
        // Upload to our own IPFS node
        const req = http.request(IPFS_HOST, { method: "POST" }, (res) => {
          const bufferString = [];
          res.on("data", (data) => {
            bufferString.push(data);
          });
          res.on("end", async () => {
            const buffer = Buffer.concat(bufferString);
            const string = buffer.toString("utf8");
            const { hash } = JSON.parse(string);
            if (hash) {
              const currentHash = await contracts[
                "mainnetsidechain"
              ].NFT.methods
                .getHash(tokenId)
                .call();
              await runSidechainTransaction(MAINNET_MNEMONIC)(
                "NFT",
                "updateHash",
                currentHash,
                hash
              );
            } else
              return res.json({
                status: ResponseStatus.Error,
                error: "Error getting hash back from IPFS node",
              });
          });
          res.on("error", (err) => {
            console.warn(err.stack);
            return res.json({ status: ResponseStatus.Error, error: err.stack });
          });
        });
        req.on("error", (err) => {
          console.warn(err.stack);
          res.json({ status: ResponseStatus.Error, error: err.stack });
        });
        file.pipe(req);
      }
    } else {
      const currentHash = await contracts["mainnetsidechain"].NFT.methods
        .getHash(tokenId)
        .call();
      await runSidechainTransaction(MAINNET_MNEMONIC)(
        "NFT",
        "updateHash",
        currentHash,
        resourceHash
      );
    }
  } catch (error) {
    console.warn(error.stack);
    return res.json({ status: ResponseStatus.Error, tokenIds: [], error });
  }
}

// // TODO: Try to unpin from pinata if we are using pinata
// async function updatePrivateData(req, res, {contracts}) {
//     async function updateHashForKeys(token, privateDataHash){
//         // TODO:
//         // First, check if it already has this private data
//         // if(token.privateData)
//         // If yes, check if pinata is true -- if it is, unpin the hash
//         // Else, unpin the hash for local node
//         // Set the new metadata

//         // const encryptedData = encodeSecret(privateData);
//         // await runSidechainTransaction(mnemonic)('NFT', 'setMetadata', token.hash, unlockableMetadataKey, encryptedData);
//         // await runSidechainTransaction(mnemonic)('NFT', 'setMetadata', token.hash, encryptedMetadataKey, encryptedData);

//     }
//     try {
//     const {mnemonic, tokenId, resourceHash, privateData} = req.body;
//     let o = await getRedisItem(tokenId, redisPrefixes.mainnetsidechainNft);
//     let token = o.Item;
//     const file = req.files && req.files[0];
//         if (!bip39.validateMnemonic(mnemonic)) {
//             return res.json({status: ResponseStatus.Error, error: "Invalid mnemonic"});
//         }

//         if (!resourceHash && !file && !privateData) {
//             return res.json({status: ResponseStatus.Error, error: "POST did not include a privateData field or a file or resourceHash"});
//         }

//         // Check if there are any files -- if there aren't, check if there's a hash
//         if (resourceHash && file) {
//             return res.json({status: ResponseStatus.Error, error: "POST should include a privateData field, resourceHash *or* file but not more than one"});
//         }

//         if (file) {
//             const readableStream = new Readable({
//                 read() {
//                     this.push(Buffer.from(file));
//                     this.push(null);
//                 }
//             });

//             // Pinata API keys are valid, so this is probably what the user wants
//             if (pinata) {
//                 // TODO: Try to unpin existing pinata hash
//                 const {IpfsHash} = pinata.pinFileToIPFS(readableStream, pinataOptions);
//                 if (IpfsHash){
//                     updateHashForKeys(token, IpfsHash);
//                 }
//                 else res.json({status: ResponseStatus.Error, error: "Error pinning to Pinata service, hash was not returned"});
//             } else {
//                 // Upload to our own IPFS node
//                 const req = http.request(IPFS_HOST, {method: 'POST'}, res => {
//                     const bufferString = [];
//                     res.on('data', data => {
//                         bufferString.push(data);
//                     });
//                     res.on('end', async () => {
//                         const buffer = Buffer.concat(bufferString);
//                         const string = buffer.toString('utf8');
//                         const {hash} = JSON.parse(string);
//                         if (hash){
//                             updateHashForKeys(token, hash);
//                         }
//                         else return res.json({status: ResponseStatus.Error, error: "Error getting hash back from IPFS node"});
//                     });
//                     res.on('error', err => {
//                         console.warn(err.stack);
//                         return res.json({status: ResponseStatus.Error, error: err.stack});
//                     });
//                 });
//                 req.on('error', err => {
//                     console.warn(err.stack);
//                     res.json({status: ResponseStatus.Error, error: err.stack});
//                 });
//                 file.pipe(req);
//             }
//         } else {
//             updateHashForKeys(token, resourceHash);
//         }
//     } catch (error) {
//         console.warn(error.stack);
//         return res.json({status: ResponseStatus.Error, tokenIds: [], error});
//     }
// }

module.exports = {
  listTokens,
  createToken,
  updatePublicAsset,
  readToken,
  readTokenWithUnlockable,
  readTokenRange,
  deleteToken,
  sendToken,
  getPrivateData,
  signTransfer,
  // readEncryptedData
};