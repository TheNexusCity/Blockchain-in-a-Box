import { Box, Button, makeStyles, Typography } from "@material-ui/core";
import React from "react";
import "../App.css";

const useStyles = makeStyles((theme) => ({
  rootBox: {
    padding: theme.spacing(8),
  },
  button: {
    width: 300,
    marginTop: 10,
  },
  red: {
    color: "red",
  },
  marginTop8: {
    marginTop: theme.spacing(8),
  },
  marginTop12: {
    marginTop: theme.spacing(12),
  },
}));

const DashboardHome: React.FunctionComponent = () => {
  const classes = useStyles();

  return (
    <Box className={classes.rootBox}>
      <Typography variant={"subtitle1"}>
        Sidechain Status: <span className={classes.red}>Not Ready</span>
      </Typography>
      <Typography>You need to deploy the contracts to the chain.</Typography>
      <Button
        className={classes.button}
        variant="contained"
        color="primary"
        size="large"
      >
        Configure Contracts
      </Button>

      <Typography variant={"subtitle1"} className={classes.marginTop8}>
        Mainnet Status: <span className={classes.red}>Not Ready</span>
      </Typography>
      <Typography>
        You need to add an Infura API key and deploy contracts to mainnet.
      </Typography>
      <Button
        className={classes.button}
        variant="contained"
        color="primary"
        size="large"
      >
        Configuration
      </Button>

      <Typography variant={"subtitle1"} className={classes.marginTop8}>
        Polygon Status: <span className={classes.red}>Not Ready</span>
      </Typography>
      <Typography>
        You need to add a MaticVigil API key and deploy contracts to Polygon.
      </Typography>
      <Button
        className={classes.button}
        variant="contained"
        color="primary"
        size="large"
      >
        Configuration
      </Button>

      <br />

      <Button
        className={`${classes.button} ${classes.marginTop12}`}
        variant="contained"
        color="secondary"
        size="large"
      >
        View Ethstats Dashboard
      </Button>
    </Box>
  );
};

export default DashboardHome;