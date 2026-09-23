/**
 * servers.json is the one input that does not come from the environment, and its
 * rules exist because each of them used to fail later and less clearly: a duplicate
 * keyword makes a server unreachable, a 26th entry makes every embed update fail
 * with an API 400, an uppercase keyword can never match a lowercased lookup.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { validateServersConfig } from "../src/config/servers.js";

/** A minimal entry that passes, for tests to vary one field of. */
const VALID = Object.freeze({ ip: "1.2.3.4:27015", keywords: ["surf"], nick: "Surf Server" });

describe("validateServersConfig, errors", () => {
    it("accepts a well formed file", () => {
        assert.deepEqual(validateServersConfig({ Surf: VALID }), { errors: [], warnings: [] });
    });

    it("accepts the servers.json.example the repository ships", () => {
        const example = JSON.parse(readFileSync(new URL("../servers.json.example", import.meta.url), "utf8"));

        assert.deepEqual(validateServersConfig(example), { errors: [], warnings: [] });
    });

    it("names every missing field of an entry", () => {
        assert.deepEqual(validateServersConfig({ Broken: {} }).errors, [
            "servers.json: \"Broken\".ip: ip is required and must be a string",
            "servers.json: \"Broken\".keywords: keywords is required and must be an array",
            "servers.json: \"Broken\".nick: nick is required and must be a string"
        ]);
    });

    it("rejects a file with no servers in it", () => {
        assert.deepEqual(validateServersConfig({}).errors, ["servers.json must define at least one server"]);
    });

    it("rejects more servers than an embed has fields", () => {
        const many = Object.fromEntries(
            Array.from({ length: 26 }, (_, index) => [`S${index}`, { ...VALID, ip: `1.2.3.${index}`, keywords: [`k${index}`] }])
        );

        assert.equal(validateServersConfig(many).errors.length, 1);
        assert.ok(validateServersConfig(many).errors[0].includes("cannot define more than 25 servers"));
    });

    it("rejects a keyword claimed by another server", () => {
        const { errors } = validateServersConfig({ A: VALID, B: { ...VALID, ip: "5.6.7.8", nick: "B" } });

        assert.equal(errors.length, 1);
        assert.ok(errors[0].includes("already used by \"A\""));
    });

    it("rejects a keyword listed twice on one server", () => {
        const { errors } = validateServersConfig({ A: { ...VALID, keywords: ["surf", "surf"] } });

        assert.deepEqual(errors, ["servers.json: \"A\".keywords: keyword \"surf\" is listed twice"]);
    });

    it("rejects an uppercase keyword that could never match a lookup", () => {
        const { errors } = validateServersConfig({ A: { ...VALID, keywords: ["Surf"] } });

        assert.equal(errors.length, 1);
        assert.ok(errors[0].startsWith("servers.json: \"A\".keywords[0]: keyword must be lowercase"));
    });

    it("rejects a port outside the valid range", () => {
        assert.deepEqual(validateServersConfig({ A: { ...VALID, ip: "1.2.3.4:99999" } }).errors, [
            "servers.json: \"A\".ip: ip port \"99999\" must be between 1 and 65535"
        ]);
    });

    it("rejects an IPv6 address, which the host:port split cannot represent", () => {
        const { errors } = validateServersConfig({ A: { ...VALID, ip: "::1:27015" } });

        assert.equal(errors.length, 1);
        assert.ok(errors[0].includes("IPv6 addresses are not supported"));
    });

    it("rejects an address with stray whitespace", () => {
        const { errors } = validateServersConfig({ A: { ...VALID, ip: " 1.2.3.4" } });

        assert.equal(errors.length, 1);
        assert.ok(errors[0].includes("leading or trailing whitespace"));
    });

    it("accepts an address with no port at all", () => {
        assert.deepEqual(validateServersConfig({ A: { ...VALID, ip: "cs.example.test" } }).errors, []);
    });

    it("reports no warnings when the file is rejected", () => {
        // The entries cannot be trusted to have the shape collectWarnings reads.
        assert.deepEqual(validateServersConfig({ A: { ...VALID, ip: 5, show: true } }).warnings, []);
    });
});

describe("validateServersConfig, warnings", () => {
    it("reports an unrecognized field without rejecting the file", () => {
        const { errors, warnings } = validateServersConfig({ A: { ...VALID, show: true } });

        assert.deepEqual(errors, []);
        assert.deepEqual(warnings, ["servers.json: \"A\" has unrecognized field(s) \"show\" which are ignored"]);
    });

    it("reports two entries pointing at one address", () => {
        const { warnings } = validateServersConfig({ A: VALID, B: { ...VALID, keywords: ["other"], nick: "B" } });

        assert.equal(warnings.length, 1);
        assert.ok(warnings[0].includes("share the address \"1.2.3.4:27015\""));
    });

    it("reports a numeric keyword, which collides with index lookups", () => {
        const { warnings } = validateServersConfig({ A: { ...VALID, keywords: ["12"] } });

        assert.equal(warnings.length, 1);
        assert.ok(warnings[0].includes("is numeric and collides with server index lookups"));
    });
});
