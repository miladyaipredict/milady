import { describe, expect, test } from "bun:test";

describe("runner module", () => {
  test("exports operator commands", async () => {
    const runner = await import("./runner");
    expect(typeof runner.verify).toBe("function");
    expect(typeof runner.chat).toBe("function");
    expect(typeof runner.settings).toBe("function");
    expect(typeof runner.inputTest).toBe("function");
  });

  test("exports are async functions", async () => {
    const runner = await import("./runner");
    expect(runner.verify.constructor.name).toBe("AsyncFunction");
    expect(runner.chat.constructor.name).toBe("AsyncFunction");
    expect(runner.settings.constructor.name).toBe("AsyncFunction");
    expect(runner.inputTest.constructor.name).toBe("AsyncFunction");
  });
});
