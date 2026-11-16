// Compatibility entry point; all storage, identity and port guards live centrally.
if (process.env.CHEMDFT_E2E_SUITE !== "geometry") {
  throw new Error("TEST_SUITE_REQUIRED: use the isolated runner with --suite geometry");
}
export { default } from "./playwright.isolated.config";
