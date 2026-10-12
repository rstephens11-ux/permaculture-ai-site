// api/engine/mock.mjs — the engine every test uses. No network, no GPU, no randomness.
//
// It returns the photo it was handed (so the shape of the response is real end-to-end) and labels
// itself `mock`. A test that asserts pixel change is a test that lies to you about the GPU path.
//
// `failPlan` and `down` exist so the tests can exercise the two failure paths that matter for an
// optional mask: a machine that is offline, and a render that throws. Both must still deliver the plan.

export function makeMockEngine({ failPlan = false, down = false } = {}) {
  return {
    name: "mock",
    denoise: 0,
    async available() {
      return !down;
    },
    async busy() {
      return false;
    },
    async plan({ imageB64, images, mime }) {
      if (failPlan) throw new Error("mock engine: render failed on purpose");
      const first = (images && images[0]) || { b64: imageB64, mime };
      return { imageB64: first.b64, mime: first.mime || "image/jpeg", engine: "mock", gpu_seconds: 0 };
    }
  };
}
