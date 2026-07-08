/* global window */

(function attachStartupModule(globalScope) {
  "use strict";

  function createStartupModule(startupSteps = []) {
    if (!Array.isArray(startupSteps)) {
      throw new Error("TimeQualityStartupModule requires a startup step list.");
    }

    function init() {
      startupSteps.forEach((step, index) => {
        if (typeof step !== "function") {
          throw new Error(`TimeQualityStartupModule startup step ${index + 1} is not callable.`);
        }
        step();
      });
    }

    return { init };
  }

  globalScope.TimeQualityStartupModule = {
    createStartupModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
