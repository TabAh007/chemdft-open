import { expect, test, type Page } from "@playwright/test";

/**
 * Release 0.0.56: the document must not disable the horizontal overscroll axis, otherwise macOS two-finger history swipe
 * stops working. A real trackpad swipe cannot be automated; this reads the computed style only.
 */
async function computed(page: Page) {
  return page.evaluate(() => {
    const read = (el: Element) => {
      const s = getComputedStyle(el);
      return { x: s.overscrollBehaviorX, y: s.overscrollBehaviorY };
    };
    return { html: read(document.documentElement), body: read(document.body) };
  });
}

for (const path of ["/en/contact", "/en/feedback", "/en/releases"]) {
  test(`horizontal overscroll stays enabled on ${path}`, async ({ page }) => {
    await page.goto(path);
    const c = await computed(page);
    console.log(path, JSON.stringify(c));
    expect(c.html.x).toBe("auto");
    expect(c.body.x).toBe("auto");
  });
}

test("workspace shell only locks the vertical axis", async ({ page }) => {
  await page.goto("/en/contact");
  // Stand-in for the project workspace layout (needs a session): the scoped rule keys on .project-shell.
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.className = "project-shell";
    document.body.appendChild(d);
  });
  const c = await computed(page);
  console.log("workspace", JSON.stringify(c));
  expect(c.html.x).toBe("auto");
  expect(c.body.x).toBe("auto");
  expect(c.html.y).toBe("none");
});

test("contact page no longer shows the owner's full name", async ({ page }) => {
  await page.goto("/en/contact");
  await expect(page.getByText("Messages are delivered directly to")).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("Tabriz");
  expect(text).not.toContain("Ahmadli");
  expect(text).toContain("the ChemDFT team (tab@chemdft.com)");
});
