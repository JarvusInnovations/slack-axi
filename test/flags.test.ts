import { describe, expect, it } from "vitest";
import { isLongFlag, takeFlag, takeFlags, textArgs } from "../src/flags.js";

describe("value flags without a value", () => {
  it("takeFlag refuses a trailing flag", () => {
    expect(() => takeFlag(["#eng", "hi", "--reply"], "--reply")).toThrow(/--reply needs a value/);
  });
  it("takeFlag refuses to take the next flag as its value", () => {
    expect(() => takeFlag(["#eng", "--reply", "--preview", "hi"], "--reply")).toThrow(
      expect.objectContaining({ code: "USAGE" }),
    );
  });
  it("accepts dash-led values that aren't long flags", () => {
    expect(takeFlag(["--tz", "-05:00"], "--tz").value).toBe("-05:00");
    expect(takeFlags(["--has", "link", "--has", "file"], "--has").values).toEqual(["link", "file"]);
  });
  it("leaves an absent flag alone", () => {
    expect(takeFlag(["#eng", "hi"], "--reply")).toEqual({ value: undefined, rest: ["#eng", "hi"] });
  });
});

describe("textArgs", () => {
  it("keeps dash-led text: list items, rules, exclusions, negatives", () => {
    const args = ["#eng", "- api ok", "---", "-draft", "-5"];
    expect(textArgs(args)).toEqual(args);
  });
  it("refuses an unknown long flag", () => {
    expect(() => textArgs(["#eng", "hi", "--tema", "T1"])).toThrow(/Unknown flag --tema/);
  });
});

describe("isLongFlag", () => {
  it("is `--` then a letter", () => {
    expect(isLongFlag("--preview")).toBe(true);
    expect(isLongFlag("---")).toBe(false);
    expect(isLongFlag("- item")).toBe(false);
    expect(isLongFlag("-v")).toBe(false);
    expect(isLongFlag("--")).toBe(false);
  });
});
