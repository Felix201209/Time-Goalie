import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5199",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "TIME_GOALIE_DATA_FILE=server/data/e2e-time-goalie.json TIME_GOALIE_ENV_FILE=server/data/e2e.env.local SERVER_PORT=8799 VITE_PORT=5199 npm run dev:full",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
