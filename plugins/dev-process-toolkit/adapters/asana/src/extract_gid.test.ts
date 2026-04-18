import { describe, expect, test } from "bun:test";
import { extractGid } from "./extract_gid";

describe("asana extractGid", () => {
  test("extracts gid from canonical URL", () => {
    expect(extractGid("https://app.asana.com/0/1199999999999999/1209876543210")).toBe(
      "1209876543210",
    );
  });

  test("handles trailing slash", () => {
    expect(extractGid("https://app.asana.com/0/1/42/")).toBe("42");
  });

  test("handles trailing query string", () => {
    expect(extractGid("https://app.asana.com/0/1/42?focus=subtasks")).toBe("42");
  });

  test("handles trailing fragment", () => {
    expect(extractGid("https://app.asana.com/0/1/42#subtask-5")).toBe("42");
  });

  test("http (not https) matches", () => {
    expect(extractGid("http://app.asana.com/0/1/42")).toBe("42");
  });

  test("whitespace around URL is tolerated", () => {
    expect(extractGid("  https://app.asana.com/0/1/42  \n")).toBe("42");
  });

  test("wrong host returns null", () => {
    expect(extractGid("https://other.asana.com/0/1/42")).toBe(null);
  });

  test("missing task gid returns null", () => {
    expect(extractGid("https://app.asana.com/0/1/")).toBe(null);
  });

  test("random string returns null", () => {
    expect(extractGid("not a url")).toBe(null);
  });

  test("empty string returns null", () => {
    expect(extractGid("")).toBe(null);
  });
});
