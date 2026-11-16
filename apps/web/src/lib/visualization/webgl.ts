/** Probe renderer support without retaining a GPU context until garbage collection. */
export function hasWebGl(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  let context: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return context !== null;
  } catch {
    return false;
  } finally {
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
