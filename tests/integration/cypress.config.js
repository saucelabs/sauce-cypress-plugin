const { defineConfig } = require("cypress");
const fs = require("fs");
const path = require("path");

module.exports = defineConfig({
  e2e: {
    video: true,
    setupNodeEvents(on, config) {
      require("../../src/index").default(on, config, {
        build: "Cypress Kitchensink Example",
        tags: ["plugin", "kitchensink", "cypress"],
        region: "us-west-1",
      });

      on("task", {
        readFileAsStream({ filePath }) {
          return new Promise((resolve, reject) => {
            const resolvedPath = path.resolve(filePath);
            if (!fs.existsSync(resolvedPath)) {
              return reject(
                new Error(`File not found at path: ${resolvedPath}`),
              );
            }

            const stream = fs.createReadStream(resolvedPath);
            const chunks = [];

            stream.on("data", (chunk) => chunks.push(chunk));
            stream.on("end", () => resolve(Buffer.concat(chunks).toString()));
            stream.on("error", reject);
          });
        },
      });

      return config;
    },
  },
});
