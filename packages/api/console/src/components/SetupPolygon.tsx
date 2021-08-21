import React, { useEffect, useReducer } from "react";
import {
  Button,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  makeStyles,
  OutlinedInput,
  Typography,
} from "@material-ui/core";
import { Visibility, VisibilityOff } from "@material-ui/icons";
import { ActionResult } from "../models/Action";
import { IBasePayload } from "../models/IPayloads";
import { useHistory } from "react-router-dom";
import Routes from "../constants/Routes";
import "../App.css";
import { RootState } from "../redux/Store";
import { useDispatch, useSelector } from "react-redux";
import {
  setError,
  setIsLoading,
  setPolygonMaticMnemonic,
} from "../redux/slice/SetupReducer";
import { GetSetupMnemonic, PostSetupVerifyMnemonic } from "../api/SetupApi";
import LoadingView from "./LoadingView";

const useStyles = makeStyles((theme) => ({
  parentBox: {
    marginTop: "10vh",
    marginBottom: theme.spacing(5),
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    maxWidth: 500,
  },
  heading: {
    textAlign: "center",
  },
  subHeading: {
    marginTop: theme.spacing(3),
  },
  error: {
    marginTop: theme.spacing(3),
  },
  button: {
    width: "100%",
  },
  textbox: {
    marginTop: theme.spacing(2),
  },
  bold: {
    fontWeight: "bold",
  },
  marginTop2: {
    marginTop: theme.spacing(2),
  },
  marginTop4: {
    marginTop: theme.spacing(4),
  },
  formLabel: {
    padding: "0 10px",
    background: "white",
  },
}));

// Local state
interface ILocalState {
  showMnemonic: boolean;
}

// Local default state
const DefaultLocalState: ILocalState = {
  showMnemonic: false,
};

// Local actions
const LocalAction = {
  ToggleMnemonic: "ToggleMnemonic",
};

// Local reducer
const LocalReducer = (
  state: ILocalState,
  action: ActionResult<IBasePayload>
): ILocalState => {
  switch (action.type) {
    case LocalAction.ToggleMnemonic: {
      return {
        ...state,
        showMnemonic: !state.showMnemonic,
      };
    }
    default: {
      return state;
    }
  }
};

const SetupPolygon: React.FunctionComponent = () => {
  const classes = useStyles();
  const history = useHistory();
  const [{ showMnemonic }, dispatch] = useReducer(
    LocalReducer,
    DefaultLocalState
  );
  const reduxDispatch = useDispatch();
  const { polygonMaticMnemonic, isLoading, error } = useSelector(
    (state: RootState) => state.setup
  );

  useEffect(() => {
    reduxDispatch(setError(""));
    initialize();
  }, []);

  const initialize = async () => {
    try {
      reduxDispatch(setIsLoading(true));
      const mnemonicResponse = await GetSetupMnemonic();
      reduxDispatch(setPolygonMaticMnemonic(mnemonicResponse.mnemonic));
    } catch (err) {
      reduxDispatch(setError(err.message));
    }
  };

  if (isLoading) {
    return <LoadingView loadingText={"Please wait"} />;
  }

  return (
    <Grid container justifyContent="center">
      <Grid className={classes.parentBox} item>
        <Typography className={classes.heading} variant="h4">
          Polygon / Matic Private Key Setup
        </Typography>

        <Typography className={classes.subHeading}>
          If you want to allow mainnet transactions on the Polygon Matic network
          you will need to set up a private key.
        </Typography>

        <Typography className={classes.marginTop2}>
          You will need to provide the mnemonic for a wallet that has enough
          MATIC token in it to mint the contracts. It is recommended that you
          set this up using Metamask.
        </Typography>

        <Typography className={`${classes.marginTop2} ${classes.bold}`}>
          Never share your private key with anyone.
        </Typography>

        <Typography className={`${classes.marginTop2} ${classes.bold}`}>
          Never keep more MATIC token in your hot wallet than you need.
        </Typography>

        <FormControl className={classes.marginTop4} variant="outlined">
          <InputLabel
            className={classes.formLabel}
            htmlFor="outlined-adornment-mnemonic"
          >
            Mnemonic
          </InputLabel>
          <OutlinedInput
            id="outlined-adornment-mnemonic"
            placeholder="Enter mnemonic"
            type={showMnemonic ? "text" : "password"}
            value={polygonMaticMnemonic}
            onChange={(event) =>
              reduxDispatch(setPolygonMaticMnemonic(event.target.value))
            }
            endAdornment={
              <InputAdornment position="end">
                <IconButton
                  onClick={() => {
                    dispatch({ type: LocalAction.ToggleMnemonic });
                  }}
                  edge="end"
                >
                  {showMnemonic ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            }
          />
        </FormControl>

        {error && (
          <Typography className={classes.error} variant="body2" color="error">
            {error}
          </Typography>
        )}

        <Grid className={classes.marginTop4} spacing={4} container>
          <Grid container item xs={6}>
            <Button
              className={classes.button}
              variant="contained"
              color="secondary"
              size="large"
              onClick={() => {
                reduxDispatch(setPolygonMaticMnemonic(""));
                reduxDispatch(setError(""));
                history.push(Routes.SETUP_POLYGON_VIGIL);
              }}
            >
              Skip
            </Button>
          </Grid>
          <Grid container item xs={6}>
            <Button
              className={classes.button}
              variant="contained"
              color="primary"
              size="large"
              onClick={async () => {
                if (!polygonMaticMnemonic) {
                  reduxDispatch(setError("Please fill mnemonic field"));
                  return;
                }

                reduxDispatch(setIsLoading(true));
                const verifyResponse = await PostSetupVerifyMnemonic(
                  polygonMaticMnemonic
                );
                if (!verifyResponse.isValid) {
                  reduxDispatch(setError("Please enter a valid mnemonic"));
                  return;
                }

                reduxDispatch(setError(""));
                history.push(Routes.SETUP_POLYGON_VIGIL);
              }}
            >
              Continue
            </Button>
          </Grid>
        </Grid>
      </Grid>
    </Grid>
  );
};

export default SetupPolygon;
