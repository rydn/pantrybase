import { describe, expect, it } from "vitest";
import { applyBump, bumpFor, decide } from "../../src/release/version.js";

const c = (subject: string, body = "") => ({ subject, body });

describe("release versioning", () => {
  it("publishes the current version as the first release", () => {
    expect(decide("0.1.0", null, [c("feat: x")])).toMatchObject({
      release: true,
      version: "0.1.0",
      bump: "initial",
    });
  });

  it("bumps patch for any merge, minor for features, from the last tag", () => {
    expect(decide("0.1.0", "v0.1.0", [c("docs: readme")])).toMatchObject({
      version: "0.1.1",
      bump: "patch",
    });
    expect(decide("0.1.0", "v0.1.3", [c("fix: a"), c("feat(ui): b")])).toMatchObject({
      version: "0.2.0",
      bump: "minor",
    });
  });

  it("treats breaking changes as minor before 1.0 and major after", () => {
    expect(bumpFor([c("feat!: drop v1 files")], "0.4.2")).toBe("minor");
    expect(bumpFor([c("fix: x", "BREAKING CHANGE: schema v4")], "1.2.0")).toBe("major");
    expect(applyBump("1.2.3", "major")).toBe("2.0.0");
  });

  it("does not release when only release commits are new", () => {
    expect(decide("0.2.0", "v0.2.0", [c("chore(release): v0.2.0")])).toMatchObject({
      release: false,
      bump: "none",
    });
  });
});
