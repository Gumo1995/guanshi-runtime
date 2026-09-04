"use strict";

const fs = require("fs");
const path = require("path");
// The same pure module is shipped in .guanshi/client; no browser globals are required.
const developmentPath = path.resolve(__dirname, "../../client/app-schedule-constraints.js");
module.exports = require(fs.existsSync(developmentPath)
  ? developmentPath
  : path.resolve(__dirname, "../client/app-schedule-constraints.js"));
