export default async function setup() {
  const env = process.env;
  if (!env.CHEMDFT_DEV_USER_ID || !env.CHEMDFT_DEV_ORGANIZATION_ID) {
    throw new Error("TEST_IDENTITY_REQUIRED");
  }
  for (const url of [
    `http://127.0.0.1:${env.CHEMDFT_E2E_API_PORT}/v1/me`,
    `http://127.0.0.1:${env.CHEMDFT_E2E_WEB_PORT}/api/chemdft/v1/me`,
  ]) {
    const response = await fetch(url);
    const identity = await response.json();
    if (!response.ok || identity.id !== env.CHEMDFT_DEV_USER_ID ||
        identity.organization?.id !== env.CHEMDFT_DEV_ORGANIZATION_ID) {
      throw new Error(`TEST_SERVICE_IDENTITY_MISMATCH: ${url}`);
    }
  }
}
