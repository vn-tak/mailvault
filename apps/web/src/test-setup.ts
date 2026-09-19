import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React trees between tests so hash-router and effect state don't leak.
afterEach(() => {
  cleanup();
  window.location.hash = "";
});
