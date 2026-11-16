/** Run inside the in-app Browser Node session against workstation-fault-proxy.mjs. */
import assert from 'node:assert/strict';
export async function verifyAiFailureAndRetry(tab, question) {
  const input=tab.playwright.getByTestId('ai-prompt-input');
  await tab.playwright.locator('[data-testid="ai-prompt-input"]:not(:disabled)').waitFor({state:'visible',timeoutMs:20000});
  await input.fill(question);
  await input.press('Shift+Enter');
  assert.ok(await tab.playwright.evaluate(()=>document.querySelector('[data-testid="ai-prompt-input"]').value.endsWith('\n')));
  await input.press('Enter');
  const pending=await tab.playwright.evaluate(()=>({
    progress:document.querySelector('[data-testid="ai-working-state"]')?.textContent,
    disabled:document.querySelector('[data-testid="ai-ask-button"]')?.disabled,
    value:document.querySelector('[data-testid="ai-prompt-input"]')?.value,
  }));
  assert.equal(pending.disabled,true); assert.equal(pending.value,''); assert.ok(pending.progress.includes('Question submitted'));
  await tab.cua.keypress({keys:['ENTER']});
  await tab.playwright.getByTestId('ai-submit-error').waitFor({state:'visible',timeoutMs:5000});
  const failed=await tab.playwright.evaluate(()=>({
    error:document.querySelector('[data-testid="ai-submit-error"]')?.textContent,
    focus:document.activeElement?.getAttribute('data-testid'),
    draft:document.querySelector('[data-testid="ai-prompt-input"]')?.value,
  }));
  assert.ok(failed.error.includes('Controlled frontend acceptance failure'));
  assert.equal(failed.focus,'ai-prompt-input'); assert.equal(failed.draft,question);
  const oldCount=await tab.playwright.getByTestId('ai-message-assistant').count();
  await tab.playwright.getByRole('button',{name:'Retry',exact:true}).click();
  await tab.playwright.locator('[data-testid="ai-prompt-input"]:not(:disabled)').waitFor({state:'visible',timeoutMs:20000});
  assert.equal(await tab.playwright.getByTestId('ai-message-assistant').count(),oldCount+1);
  assert.ok((await tab.playwright.getByTestId('ai-message-assistant').last().textContent()).includes('SUPPORTED'));
  return { pending, failed, retrySucceeded:true };
}
