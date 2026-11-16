/**
 * The one place GSAP and ScrollTrigger are loaded. Imported lazily (after hydration, only where motion is allowed) so
 * the initial homepage JavaScript does not carry it; every caller creates its triggers inside a `gsap.context()` and
 * reverts it on unmount, so navigating away leaves no listeners or pin spacers behind.
 */
export async function loadGsap() {
  const [{ gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
  gsap.registerPlugin(ScrollTrigger);
  // development/test builds expose the live trigger count so tests can prove cleanup; production never does
  if (process.env.NODE_ENV !== "production") (window as unknown as { __chemdftScrollTriggers?: () => number }).__chemdftScrollTriggers = () => ScrollTrigger.getAll().length;
  return { gsap, ScrollTrigger };
}
