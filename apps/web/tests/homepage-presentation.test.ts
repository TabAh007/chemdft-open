import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationTransaction } from "../src/app/_components/home/presentation-transaction";

const crystal = { key: "crystal", geometry: "Cr₂O₃", provenance: "COD", representation: "polyhedra", camera: "crystal-view" };
const water = { key: "water", geometry: "H₂O", provenance: "test geometry", representation: "ball-stick", camera: "water-view" };
const benzene = { ...water, key: "benzene", geometry: "C₆H₆", provenance: "PubChem 241" };

afterEach(() => vi.useRealTimers());

describe("scientific presentation transactions", () => {
  it("keeps the whole outgoing identity until a hidden atomic commit and renderer acknowledgment", () => {
    vi.useFakeTimers();
    const tx = new PresentationTransaction(crystal);
    tx.request(water);
    expect(tx.getSnapshot()).toEqual({ revision: 0, displayed: crystal, requested: water, phase: "out" });
    vi.advanceTimersByTime(139);
    expect(tx.getSnapshot().displayed).toBe(crystal);
    vi.advanceTimersByTime(1);
    expect(tx.getSnapshot()).toEqual({ revision: 1, displayed: water, requested: water, phase: "fitting" });
    tx.presented(crystal.key);
    expect(tx.getSnapshot().phase).toBe("fitting");
    tx.presented(water.key);
    expect(tx.getSnapshot().phase).toBe("in");
    vi.advanceTimersByTime(200);
    expect(tx.getSnapshot().phase).toBe("settled");
  });

  it("cancels obsolete requests and stale reveal callbacks; the final request wins", () => {
    vi.useFakeTimers();
    const tx = new PresentationTransaction(crystal);
    tx.request(water);
    vi.advanceTimersByTime(80);
    tx.request(benzene);
    vi.advanceTimersByTime(60);
    expect(tx.getSnapshot().displayed).toBe(crystal);
    vi.advanceTimersByTime(80);
    expect(tx.getSnapshot().displayed).toBe(benzene);
    tx.presented(water.key);
    expect(tx.getSnapshot().phase).toBe("fitting");
    tx.presented(benzene.key);
    tx.request(water);
    vi.advanceTimersByTime(200);
    expect(tx.getSnapshot().displayed).toBe(water);
    expect(tx.getSnapshot().phase).toBe("fitting");
  });

  it("restores the displayed choice immediately and cancels on unmount", () => {
    vi.useFakeTimers();
    const tx = new PresentationTransaction(crystal);
    tx.request(water);
    tx.request(crystal);
    vi.runAllTimers();
    expect(tx.getSnapshot().displayed).toBe(crystal);
    tx.request(water);
    tx.cancel();
    vi.runAllTimers();
    expect(tx.getSnapshot().displayed).toBe(crystal);
  });

  it("requires the current revision when returning to a previously drawn structure after an unacknowledged offscreen commit", () => {
    vi.useFakeTimers();
    const tx = new PresentationTransaction(crystal);
    tx.request(water);
    vi.advanceTimersByTime(140);
    tx.request(crystal);
    vi.advanceTimersByTime(140);
    expect(tx.getSnapshot().revision).toBe(2);
    tx.presented(crystal.key, 0);
    expect(tx.getSnapshot().phase).toBe("fitting");
    tx.presented(crystal.key, 2);
    vi.advanceTimersByTime(200);
    expect(tx.getSnapshot().phase).toBe("settled");
  });

  it("reduced motion commits without a timed or hidden state", () => {
    vi.useFakeTimers();
    const tx = new PresentationTransaction(crystal);
    tx.request(water, true);
    expect(tx.getSnapshot()).toEqual({ revision: 1, displayed: water, requested: water, phase: "settled" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
