// Generated alias addresses (the local part), shared by the app and the
// Worker, which creates aliases for password managers (see api/compat.ts).

import { generate as randomWords } from "random-words";
import { parse as parseDomain } from "tldts";

export const AliasFormats = ["characters", "words", "domain", "custom"] as const;
export type AliasFormat = (typeof AliasFormats)[number];

export const AliasPrefixFormats = [
    "none",
    "domainWithoutExtension",
    "domainWithExtension",
    "fullDomain",
    "custom",
] as const;
export type AliasPrefixFormat = (typeof AliasPrefixFormats)[number];

/** How addresses are made up; the app keeps these as the user's defaults. */
export type AddressFormat = {
    format?: AliasFormat;
    characterCount?: number;
    wordCount?: number;
    separator?: string;
    prefixFormat?: AliasPrefixFormat;
};

/**
 * The format of an API key's aliases: there's no one to type a custom name or
 * prefix, and the "domain" format needs a domain prefix.
 */
export type ApiKeyFormat = Omit<AddressFormat, "format" | "prefixFormat"> & {
    format: Exclude<AliasFormat, "custom">;
    prefixFormat?: Exclude<AliasPrefixFormat, "custom">;
};

export type GenerateAliasOptions = AddressFormat & {
    customPrefix?: string;
    /** The website the alias is for, for the prefix and the "domain" format. */
    hostname?: string;
};

const DEFAULT_CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function randomString(length: number, charSet = DEFAULT_CHARSET): string {
    if (charSet.length <= 0) return "";

    const array = new Uint32Array(length);
    crypto.getRandomValues(array);

    let result = "";
    for (let i = 0; i < length; i++) {
        result += charSet[(array[i] ?? 0) % charSet.length];
    }

    return result;
}

/** The local part of a new alias. */
export function generateAliasAddress({
    format = "characters",
    characterCount = 5,
    wordCount = 2,
    separator = "_",
    prefixFormat = "none",
    customPrefix,
    hostname,
}: GenerateAliasOptions): string {
    let prefix = "";
    if (prefixFormat === "custom" && customPrefix) {
        prefix = customPrefix.trim();
    } else if (hostname) {
        const parsedHostname = parseDomain(hostname);

        if (prefixFormat === "domainWithoutExtension" && parsedHostname.domainWithoutSuffix) {
            prefix = parsedHostname.domainWithoutSuffix;
        } else if (prefixFormat === "domainWithExtension" && parsedHostname.domain) {
            prefix = parsedHostname.domain;
        } else if (prefixFormat === "fullDomain") {
            prefix = parsedHostname.hostname ?? hostname;
        }
    }

    if (prefix !== "" && format !== "domain") {
        prefix = `${prefix}${separator}`;
    }

    switch (format) {
        case "characters":
            return `${prefix}${randomString(characterCount)}`.toLowerCase();
        case "words":
            return `${prefix}${randomWords({ exactly: wordCount, join: separator })}`.toLowerCase();
        case "domain":
            return prefix.toLowerCase();
        default:
            throw new Error("Invalid alias type.");
    }
}
