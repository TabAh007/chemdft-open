import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { mockAi } from "./ai-context-mock";

/**
 * AI Scientist panel layout at desktop widths (>= 1280 px), dock open and closed. Presentation-fixture mock API (jobs) with the
 * AI endpoints mocked in the browser: no AI provider, engine, database or real project. Select a workspace mode with AI_PANEL_MODE
 * (guided | advanced). Captures go to AI_PANEL_CAPTURES (default /tmp/ai-panel-captures).
 */
const URL = "/en/projects/00000000-0000-4000-8000-0000000000a1/jobs";
const SIZES = [[1280, 720], [1280, 800], [1440, 900], [1920, 1080]] as const;
const MODE = process.env.AI_PANEL_MODE ?? "guided";
const CAPTURES = process.env.AI_PANEL_CAPTURES ?? "/tmp/ai-panel-captures";

async function open(page: Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.addInitScript((mode) => { try { localStorage.setItem("chemdft:workspace-mode", mode); } catch { /* optional */ } }, MODE);
  await page.goto(URL);
  await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 60_000 });
}
const rect = (page: Page, selector: string) => page.evaluate((s) => {
  const el = document.querySelector<HTMLElement>(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, height: r.height, scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth };
}, selector);

test.describe("AI Scientist panel layout", () => {
  test.setTimeout(180_000);
  mkdirSync(CAPTURES, { recursive: true });

  for (const [w, h] of SIZES) {
    test(`${w}x${h}: the chat column fits, the composer is reachable and the context badge is whole (${MODE})`, async ({ page }) => {
      await mockAi(page, { emptyInventory: true });
      await open(page, w, h);
      const chat = (await rect(page, ".ai-chat-container"))!;
      expect(chat.scrollH, "the chat column does not scroll as a whole").toBeLessThanOrEqual(chat.clientH + 1);
      const composer = (await rect(page, ".ai-composer-wrapper"))!;
      expect(composer.bottom, "composer is inside the viewport").toBeLessThanOrEqual(h + 1);
      const conversation = (await rect(page, ".ai-conversation-scroll"))!;
      expect(conversation.height, "the conversation keeps a usable height").toBeGreaterThanOrEqual(120);
      const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
      expect(doc.sw, "no horizontal page overflow").toBeLessThanOrEqual(doc.cw);
      expect(doc.sh, "no vertical page overflow").toBeLessThanOrEqual(doc.ch);
      // The grounding badge is never truncated or hidden when present.
      const badge = page.getByTestId("ai-context-grounding");
      if (await badge.isVisible()) {
        await expect(badge).toHaveText("Named, not grounded");
        const whole = await badge.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= document.querySelector(".ai-scientist-panel")!.getBoundingClientRect().right + 1);
        expect(whole).toBe(true);
      }
      // Follow AI acts only in the Workspace.
      await expect(page.getByTestId("ai-view-mode-toggle")).toHaveCount(0);
      await page.screenshot({ path: resolve(CAPTURES, `${MODE}-${w}x${h}-dock-open.png`) });
    });

    test(`${w}x${h}: the composer is compact: one input line and one action row (${MODE})`, async ({ page }) => {
      await mockAi(page, { emptyInventory: true });
      await open(page, w, h);
      const composer = (await rect(page, ".ai-composer-wrapper"))!;
      expect(composer.height, "composer stays compact").toBeLessThanOrEqual(100);
      const toolbar = (await rect(page, ".ai-composer-toolbar"))!;
      expect(toolbar.height, "the action row is one row").toBeLessThanOrEqual(40);
      await expect(page.getByTestId("ai-composer-mode-scope")).toContainText("Ask anything about this project");
      await page.locator(".ai-composer-wrapper").screenshot({ path: resolve(CAPTURES, `${MODE}-${w}x${h}-composer.png`) });
    });

    test(`${w}x${h}: opening More floats over the chat and never shrinks it (${MODE})`, async ({ page }) => {
      await mockAi(page, { emptyInventory: true });
      await open(page, w, h);
      const before = (await rect(page, ".ai-conversation-scroll"))!;
      await page.locator('[aria-controls="ai-composer-options-body"]').click();
      const body = page.getByTestId("ai-composer-options-body");
      await expect(body).toBeVisible();
      const after = (await rect(page, ".ai-conversation-scroll"))!;
      expect(after.height, "the conversation keeps its height with More open").toBeGreaterThanOrEqual(before.height - 1);
      const inside = await body.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const d = document.querySelector(".ai-scientist-panel")!.getBoundingClientRect();
        return r.left >= d.left - 1 && r.right <= d.right + 1 && r.top >= 0;
      });
      expect(inside, "the More panel stays inside the dock and the viewport").toBe(true);
      await page.screenshot({ path: resolve(CAPTURES, `${MODE}-${w}x${h}-more-open.png`) });
    });

    test(`${w}x${h}: closing the dock leaves no overflow and reopening restores the panel (${MODE})`, async ({ page }) => {
      test.skip(MODE === "advanced", "The Advanced Workbench always shows its dock; closing it is a Guided-mode action.");
      await mockAi(page, { emptyInventory: true });
      await open(page, w, h);
      const toggle = page.getByTestId("ai-dock-toggle");
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.getByTestId("ai-scientist-panel")).toBeHidden();
      const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
      expect(doc.sw).toBeLessThanOrEqual(doc.cw);
      expect(doc.sh).toBeLessThanOrEqual(doc.ch);
      await page.screenshot({ path: resolve(CAPTURES, `${MODE}-${w}x${h}-dock-closed.png`) });
      await toggle.click();
      await expect(page.getByTestId("ai-scientist-panel")).toBeVisible();
      const chat = (await rect(page, ".ai-chat-container"))!;
      expect(chat.scrollH).toBeLessThanOrEqual(chat.clientH + 1);
    });
  }

  test("Tools and Settings open from the overflow menu with the keyboard, and Options shows run limits", async ({ page }) => {
    await mockAi(page, { emptyInventory: true });
    await open(page, 1280, 720);
    await expect(page.getByTestId("ai-nav-tools")).toHaveCount(0);
    const more = page.getByTestId("ai-nav-more");
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ai-more-menu")).toBeVisible();
    await expect(page.getByTestId("ai-menu-tools")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("ai-menu-settings")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ai-settings-view")).toBeVisible();
    await expect(page.getByTestId("ai-nav-settings")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("ai-nav-settings")).toBeFocused();
    await page.getByTestId("ai-nav-chat").click();
    await expect(page.getByTestId("ai-nav-settings")).toHaveCount(0);
    // Escape closes the menu and keeps the current tab.
    await more.click();
    await expect(page.getByTestId("ai-more-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ai-more-menu")).toBeHidden();
    await expect(page.getByTestId("ai-nav-chat")).toHaveAttribute("aria-selected", "true");
    // Options: closed by default; opening shows the run limits; a changed limit puts a dot on the button.
    const options = page.getByTestId("ai-composer-options");
    await expect(page.getByTestId("ai-composer-options-body")).toBeHidden();
    await options.click();
    await expect(page.getByText("Set lower limits for this run")).toBeVisible();
    await expect(page.getByTestId("ai-composer-options-changed")).toHaveCount(0);
    await page.getByLabel("Set lower limits for this run").check();
    await expect(page.getByTestId("ai-composer-options-changed")).toBeVisible();
    // With the limits open at 1280x720 the column may scroll, but the composer stays reachable (sticky) and the page does not overflow.
    const composer = (await rect(page, ".ai-composer-wrapper"))!;
    expect(composer.bottom).toBeLessThanOrEqual(720 + 1);
    const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(doc.sw).toBeLessThanOrEqual(doc.cw);
    await page.screenshot({ path: resolve(CAPTURES, `${MODE}-1280x720-options-open.png`) });
  });

  test("1440x900 panel density: conversation area >= 65% of panel height and two Q+A turns visible without scrolling", async ({ page }) => {
    const turns = [
      { role: "user" as const, content: "What calculations have we run for this molecule?" },
      { role: "assistant" as const, content: "Two calculations have completed: a PySCF B3LYP/6-31G(d) energy (-40.5184 Eh) and a geometry optimization." },
      { role: "user" as const, content: "What is the highest occupied molecular orbital energy?" },
      { role: "assistant" as const, content: "The HOMO energy is -0.279 Hartree (-7.59 eV) and the LUMO is 0.042 Hartree (+1.14 eV), giving a band gap of 8.73 eV." },
    ];
    await mockAi(page, { emptyInventory: true, customMessages: turns });
    await open(page, 1440, 900);
    const scrollInfo = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".ai-conversation-scroll");
      const panel = document.querySelector<HTMLElement>(".ai-scientist-panel");
      if (!el || !panel) return null;
      const bubbles = Array.from(el.querySelectorAll<HTMLElement>(".ai-message-bubble"));
      const bubblesHeight = bubbles.reduce((acc, b) => acc + b.getBoundingClientRect().height, 0);
      return {
        panelHeight: panel.clientHeight,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        conversationRatio: el.clientHeight / panel.clientHeight,
        bubblesCount: bubbles.length,
        bubblesHeight,
        ratio: bubblesHeight / el.clientHeight,
      };
    });
    expect(scrollInfo).not.toBeNull();
    console.log("DENSITY_MEASURED", JSON.stringify(scrollInfo));
    expect(scrollInfo!.bubblesCount).toBe(4);
    expect(scrollInfo!.scrollHeight, "two Q+A turns fit without scrolling").toBeLessThanOrEqual(scrollInfo!.clientHeight + 2);
    expect(scrollInfo!.conversationRatio, "conversation area takes at least 65% of panel height").toBeGreaterThanOrEqual(0.65);
    expect(scrollInfo!.ratio, "message bubbles take at least 60% of height").toBeGreaterThanOrEqual(0.60);
    await page.screenshot({ path: resolve(CAPTURES, `${MODE}-1440x900-density-two-turns.png`) });
  });

  test("scroll behavior: jumps to bottom on send, aligns start of new answer, and preserves reading position if scrolled up", async ({ page }) => {
    const initialTurns = [
      {
        role: "user" as const,
        content: "First question: give me a comprehensive overview of the chemical system and all calculation records stored in this project.",
      },
      {
        role: "assistant" as const,
        content: "Overview: This project contains ground-state molecular and periodic structures, verified calculation records, and research documentation. Stored calculations include Hartree-Fock and Density Functional Theory (DFT) single-point energy evaluations, vibrational frequency analysis across infrared and Raman active regions, and geometry optimizations performed with split-valence basis sets. All numerical values originate strictly from verified quantum chemistry engines and adhere to the Scientific Result Firewall.",
      },
      {
        role: "user" as const,
        content: "Second question: what are the key methods, functionals, and basis sets used across the energy evaluations?",
      },
      {
        role: "assistant" as const,
        content: "The key computational methods utilized include restricted Hartree-Fock (RHF), B3LYP hybrid density functional theory, and PBE generalized gradient approximation. Basis sets span minimal STO-3G for rapid exploratory benchmarks up to Pople split-valence 6-31G(d) and def2-SVP for reliable equilibrium structures. Dispersion corrections such as Grimme D3/D4 are noted where applicable.",
      },
      {
        role: "user" as const,
        content: "Third question: summarize the vibrational analysis and thermodynamic properties.",
      },
      {
        role: "assistant" as const,
        content: "Vibrational analysis identified harmonic normal modes without imaginary frequencies, confirming that the optimized geometry corresponds to a true local minimum on the potential energy surface. Zero-point vibrational energy (ZPVE), thermal corrections to enthalpy, and Gibbs free energy at standard ambient conditions (298.15 K, 1 atm) were computed using ideal-gas rigid-rotor harmonic-oscillator approximations.",
      },
      {
        role: "user" as const,
        content: "Fourth question: provide details on the frontier molecular orbitals and electrostatic potential.",
      },
      {
        role: "assistant" as const,
        content: "The highest occupied molecular orbital (HOMO) exhibits significant electron density localized on the heteroatom p-orbitals, while the lowest unoccupied molecular orbital (LUMO) displays antibonding pi* character across the conjugated backbone. The resulting HOMO-LUMO fundamental gap provides qualitative insight into chemical reactivity and kinetic stability.",
      },
    ];
    const longAnswerText = [
      "Based on the stored calculation records and verified electronic structure results, here is the comprehensive analysis:",
      "1. Ground State Electronic Structure: The restricted Kohn-Sham self-consistent field iterations converged within 14 cycles to a tight energy threshold of 1e-8 Hartree. The total electronic energy evaluated with B3LYP/def2-SVP is -40.51842 Eh. Mulliken and Löwdin population analyses confirm strong covalent character along the principal coordination axes, with minimal spin contamination.",
      "2. Frontier Orbitals & Density of States: The HOMO level is situated at -7.59 eV (-0.279 Eh), primarily composed of centered p_z atomic orbitals with slight delocalization into adjacent pi-bonding frameworks. The LUMO is positioned at +1.14 eV (+0.042 Eh), yielding an optical bandgap estimate of 8.73 eV.",
      "3. Vibrational Modes & Thermochemistry: Harmonic frequency calculations reveal zero imaginary frequencies, establishing that the current coordinates represent a confirmed local minimum on the Born-Oppenheimer potential energy surface. Zero-point vibrational energy (ZPVE) contributes 0.0821 Hartree to the ground state.",
      "4. Geometry & Coordination Metrics: The nearest-neighbour distances computed from the stored structure show bond lengths consistent with standard crystallographic databases, and angles conform closely to ideal polyhedral coordination geometries.",
      "5. Scientific Integrity & Firewall Summary: All reported metrics originate strictly from verified engine outputs under strict compliance with the Scientific Result Firewall. No synthetic or unverified values have been introduced into these records.",
    ].join("\n\n");
    const mock = await mockAi(page, { emptyInventory: true, customMessages: initialTurns, answerText: longAnswerText });
    await open(page, 1440, 900);

    // Expand previous conversation history so seeded turns populate the scroll viewport
    const history = page.getByTestId("ai-history");
    if (await history.isVisible()) {
      await history.locator("summary").click();
    }

    await expect(page.locator(".ai-message-bubble")).toHaveCount(initialTurns.length);

    const initScroll = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".ai-conversation-scroll");
      const details = document.querySelector<HTMLDetailsElement>(".ai-conversation-history");
      const bubbles = Array.from(document.querySelectorAll<HTMLElement>(".ai-message-bubble"));
      return {
        detailsFound: Boolean(details),
        detailsOpen: details?.open,
        detailsHTML: details?.outerHTML.slice(0, 200),
        bubblesCount: bubbles.length,
        bubblesHeights: bubbles.map((b) => ({ h: b.getBoundingClientRect().height, top: b.getBoundingClientRect().top })),
        scrollH: el?.scrollHeight,
        clientH: el?.clientHeight,
        scrollT: el?.scrollTop,
      };
    });
    console.log("DEBUG_INIT_SCROLL", JSON.stringify(initScroll));
    expect(initScroll).not.toBeNull();
    expect(initScroll!.scrollH!).toBeGreaterThan(initScroll!.clientH!);

    // Turn 1: User sends a new question
    const replyGate = mock.hold();
    const promptInput = page.getByTestId("ai-prompt-input");
    await promptInput.fill("What is the latest result?");
    await page.getByTestId("ai-ask-button").click();

    // Verify: after send, the scroller is positioned at the bottom so user's new message is visible
    await expect.poll(async () => {
      return page.evaluate(() => {
        const el = document.querySelector<HTMLElement>(".ai-conversation-scroll");
        if (!el) return -1;
        return el.scrollHeight - el.scrollTop - el.clientHeight;
      });
    }, { timeout: 5000 }).toBeLessThanOrEqual(10);

    // Release the assistant response gate
    replyGate.release();

    // Verify: when the assistant answer arrives, the scroller aligns the start of the new assistant bubble
    await expect(page.locator(".ai-message-bubble.assistant").last()).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => {
      return page.evaluate(() => {
        const el = document.querySelector<HTMLElement>(".ai-conversation-scroll");
        const bubbles = el?.querySelectorAll<HTMLElement>(".ai-message-bubble.assistant");
        const last = bubbles ? bubbles[bubbles.length - 1] : null;
        if (!el || !last) return 999;
        const elRect = el.getBoundingClientRect();
        const bubbleRect = last.getBoundingClientRect();
        return Math.abs(bubbleRect.top - elRect.top);
      });
    }, { timeout: 5000 }).toBeLessThanOrEqual(25);

    // Turn 2: User scrolls up to read earlier text
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".ai-conversation-scroll");
      if (el) el.scrollTop = 50;
    });
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".ai-conversation-scroll");
      el?.dispatchEvent(new Event("scroll"));
    });

    const scrollPosBefore = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".ai-conversation-scroll");
      return el ? el.scrollTop : null;
    });
    expect(scrollPosBefore).toBeLessThanOrEqual(60);

    await promptInput.fill("Another follow-up question while reading earlier turns.");
    await page.getByTestId("ai-ask-button").click();
    await expect(page.locator(".ai-message-bubble.user").last()).toBeVisible();
    await page.screenshot({ path: resolve(CAPTURES, `${MODE}-1440x900-scroll-behavior.png`) });
  });

  for (const dockW of [340, 379, 460] as const) {
    test(`dock width ${dockW}px (Advanced mode): no overlapping controls, tablist scrollWidth <= clientWidth, all controls clickable`, async ({ page }) => {
      await mockAi(page, { emptyInventory: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript((w) => {
        try {
          localStorage.setItem("chemdft:workspace-mode", "advanced");
          localStorage.setItem("chemdft:dock-width", String(w));
        } catch { /* optional */ }
      }, dockW);
      await page.goto(URL);
      await expect(page.getByTestId("ai-scientist-panel")).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId("ai-prompt-input")).toBeEnabled({ timeout: 60_000 });

      // Force dock width to exact dockW for strict dimensional acceptance
      await page.evaluate((w) => {
        const shell = document.querySelector<HTMLElement>(".project-shell");
        if (shell) shell.style.setProperty("--cdf-dock-w", `${w}px`, "important");
      }, dockW);
      await page.waitForTimeout(100);

      // Verify measured panel clientWidth is approximately dockW
      const panel = page.getByTestId("ai-scientist-panel");
      const panelWidth = await panel.evaluate((el) => el.clientWidth);
      expect(Math.abs(panelWidth - dockW)).toBeLessThanOrEqual(2);

      // 1. Tablist scrollWidth <= clientWidth
      const tablist = page.locator(".ai-scientist-tablist");
      await expect(tablist).toBeVisible();
      const tablistMetrics = await tablist.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(tablistMetrics.scrollWidth, `tablist does not overflow at ${dockW}px`).toBeLessThanOrEqual(tablistMetrics.clientWidth + 1);

      // 2. No two interactive controls in the header have overlapping bounding boxes
      const overlaps = await page.evaluate(() => {
        const nav = document.querySelector(".ai-scientist-nav");
        if (!nav) return ["nav not found"];
        const controls = Array.from(nav.querySelectorAll<HTMLElement>("button, [role='tab'], [role='button']"))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });
        const collisions: string[] = [];
        for (let i = 0; i < controls.length; i++) {
          const a = controls[i]!;
          const ra = a.getBoundingClientRect();
          const nameA = a.getAttribute("data-testid") || a.innerText.trim() || a.className;
          for (let j = i + 1; j < controls.length; j++) {
            const b = controls[j]!;
            const rb = b.getBoundingClientRect();
            const nameB = b.getAttribute("data-testid") || b.innerText.trim() || b.className;
            const overlapX = ra.left < rb.right - 0.5 && ra.right > rb.left + 0.5;
            const overlapY = ra.top < rb.bottom - 0.5 && ra.bottom > rb.top + 0.5;
            if (overlapX && overlapY) {
              collisions.push(`${nameA} [${ra.left.toFixed(1)},${ra.right.toFixed(1)}] overlaps ${nameB} [${rb.left.toFixed(1)},${rb.right.toFixed(1)}]`);
            }
          }
        }
        return collisions;
      });
      expect(overlaps, `no control overlaps at ${dockW}px`).toEqual([]);

      // 2b. No composer control extends past the dock's right edge (0.0.60 live fix: 10 px overflow, clipped Ask).
      const composerOverflow = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("[data-testid='ai-scientist-panel']");
        const form = document.querySelector<HTMLElement>(".ai-composer-toolbar");
        if (!panel || !form) return ["composer toolbar not found"];
        const edge = panel.getBoundingClientRect().right + 0.5;
        const left = panel.getBoundingClientRect().left - 0.5;
        const out: string[] = [];
        for (const el of Array.from(form.querySelectorAll<HTMLElement>("button, input, [role='button']"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > edge || r.left < left) out.push(`${el.getAttribute("data-testid") || el.innerText.trim()} [${r.left.toFixed(1)},${r.right.toFixed(1)}] vs dock right ${edge.toFixed(1)}`);
        }
        return out;
      });
      expect(composerOverflow, `composer controls stay inside the dock at ${dockW}px`).toEqual([]);
      await expect(page.getByTestId("ai-ask-button")).toBeInViewport();

      // 3. Inspector and AI Scientist tabs have a visible gap (read as two distinct tabs)
      const inspectorTab = page.getByTestId("dock-inspector-tab");
      const aiTab = page.getByTestId("ai-scientist-tab");
      await expect(inspectorTab).toBeVisible();
      await expect(aiTab).toBeVisible();
      const inspectorBox = await inspectorTab.boundingBox();
      const aiBox = await aiTab.boundingBox();
      expect(inspectorBox).toBeTruthy();
      expect(aiBox).toBeTruthy();
      const tabGap = aiBox!.x - (inspectorBox!.x + inspectorBox!.width);
      expect(tabGap, `visible gap between Inspector and AI Scientist tabs at ${dockW}px`).toBeGreaterThanOrEqual(2);

      // 4. Every control is clickable by a real mouse click without force
      await page.getByTestId("dock-inspector-tab").click({ trial: true });
      await page.getByTestId("ai-scientist-tab").click({ trial: true });
      await page.getByTestId("ai-nav-chat").click();
      await page.getByTestId("ai-nav-evidence").click();
      await page.getByTestId("ai-nav-runs").click();
      await page.getByTestId("ai-nav-more").click();
      await expect(page.getByTestId("ai-more-menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("ai-more-menu")).toBeHidden();
      await page.getByTestId("ai-expand-toggle").click({ trial: true });

      // Return to Chat tab
      await page.getByTestId("ai-nav-chat").click();

      // Screenshot under output/
      mkdirSync("output", { recursive: true });
      await page.screenshot({ path: `output/dock-header-${dockW}px.png` });
    });
  }
});
