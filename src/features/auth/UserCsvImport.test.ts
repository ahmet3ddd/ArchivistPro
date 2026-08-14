import { describe, expect, it } from "vitest";

import { parseUsersCsv } from "./UserCsvImport";

describe("parseUsersCsv", () => {
  it("parses headered comma CSV, quotes, and valid roles", () => {
    expect(parseUsersCsv('username,password,role\nali,"a,b",admin\nveli,secret,editor')).toEqual([
      { username: "ali", password: "a,b", role: "admin" },
      { username: "veli", password: "secret", role: "editor" },
    ]);
  });

  it("supports semicolon CSV and safely defaults an unknown role", () => {
    expect(parseUsersCsv("username;password;role\nada;secret;owner\nberk;pw;viewer")).toEqual([
      { username: "ada", password: "secret", role: "viewer" },
      { username: "berk", password: "pw", role: "viewer" },
    ]);
  });

  it("rejects a missing required header", () => {
    expect(parseUsersCsv("name,password\nali,secret")).toEqual([]);
  });
});
