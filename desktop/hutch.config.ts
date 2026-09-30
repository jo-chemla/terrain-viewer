// Hutch is Electrobun's build CLI (https://blackboard.sh/electrobun/). The
// pin is the release these tasks were written against; `hutch electrobun
// update` moves it. See desktop/README.md.
export default {
  electrobun: {
    version: "2.0.2",
  },
  scripts: {
    install: ["hutch", "install", "--frozen-lockfile"],
    config: ["node", "gen-config.mjs"],
    dev: ["hutch", "electrobun", "dev", "--watch"],
    build: ["hutch", "electrobun", "build", "--env=stable"],
  },
};
