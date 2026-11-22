// Worker app: keys for password managers such as Bitwarden, which create
// aliases through the Worker's addy.io- and SimpleLogin-compatible endpoints.

import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { HStack } from "@astryxdesign/core/HStack";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { VStack } from "@astryxdesign/core/VStack";
import type { ApiKeyFormat } from "@mailflare/worker/alias-address";
import { type FormEvent, useState } from "react";
import { TbCopy, TbKey, TbPlus, TbTrash } from "react-icons/tb";
import { useFormatter, useTranslations } from "use-intl";

import type { ApiKey } from "../../backend/types";
import { useApiKeys, useMailflare } from "../../backend/use-mailflare";
import { useOnlineStatus } from "../../hooks/use-online-status";
import { useAliasSettingsStore } from "../../stores/alias-settings-store";
import { useAuthStore } from "../../stores/auth-store";
import { PageBody, PageHeader } from "./page-header";

type KeyFormat = ApiKeyFormat & Required<Pick<ApiKeyFormat, "prefixFormat">>;

/** The app's default alias format, as far as a key can use it (no custom names). */
function defaultFormat(): KeyFormat {
    const settings = useAliasSettingsStore.getState();
    const format = settings.format === "words" ? "words" : "characters";
    const prefix = settings.prefixFormat;
    return {
        format,
        prefixFormat: prefix && prefix !== "custom" ? prefix : "none",
        // The same fallbacks as the create dialog.
        characterCount: settings.characterCount ?? 5,
        wordCount: settings.wordCount ?? 2,
        separator: settings.separator ?? "_",
    };
}

export function ApiKeysPage() {
    const t = useTranslations("api_keys");
    const toast = useToast();
    const format = useFormatter();
    const { isOnline } = useOnlineStatus();
    const { apiKeys, deleteApiKey } = useApiKeys();
    const [createOpen, setCreateOpen] = useState(false);
    const [created, setCreated] = useState<{ apiKey: ApiKey; key: string } | null>(null);
    const [deleting, setDeleting] = useState<ApiKey | null>(null);

    const date = (seconds: number) =>
        format.dateTime(new Date(seconds * 1000), { dateStyle: "medium" });

    return (
        <PageBody>
            <PageHeader title={t("title")} description={t("description")} />
            <HStack>
                <Button
                    variant="primary"
                    label={t("create")}
                    icon={<TbPlus />}
                    isDisabled={!isOnline}
                    onClick={() => setCreateOpen(true)}
                />
            </HStack>
            <VStack gap={3}>
                {apiKeys.isPending && <Spinner />}
                {apiKeys.isError && (
                    <Banner status="error" title={t("error", { error: apiKeys.error.message })} />
                )}
                {apiKeys.data?.length === 0 && <Text type="supporting">{t("empty")}</Text>}
                {apiKeys.data?.map((apiKey) => (
                    <HStack key={apiKey.id} gap={3} align="center">
                        <TbKey aria-hidden style={{ flexShrink: 0 }} />
                        <VStack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
                            <Text weight="semibold" maxLines={1}>
                                {apiKey.name}
                            </Text>
                            <Text type="supporting" maxLines={2}>
                                {t("summary", {
                                    start: apiKey.start,
                                    destination: apiKey.destination,
                                    used: apiKey.lastUsedAt
                                        ? t("last_used", { date: date(apiKey.lastUsedAt) })
                                        : t("never_used"),
                                })}
                            </Text>
                        </VStack>
                        <IconButton
                            label={t("delete")}
                            icon={<TbTrash />}
                            variant="ghost"
                            isDisabled={!isOnline}
                            onClick={() => setDeleting(apiKey)}
                        />
                    </HStack>
                ))}
            </VStack>

            <CreateKeyDialog
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={(result) => {
                    setCreateOpen(false);
                    setCreated(result);
                }}
            />
            <CreatedKeyDialog created={created} onClose={() => setCreated(null)} />
            <AlertDialog
                isOpen={deleting !== null}
                onOpenChange={(isOpen) => !isOpen && setDeleting(null)}
                title={t("delete_title")}
                description={t("delete_description", { name: deleting?.name ?? "" })}
                actionLabel={t("delete")}
                cancelLabel={t("cancel")}
                onAction={() => {
                    if (!deleting) return;
                    deleteApiKey.mutate(deleting.id, {
                        onSuccess: () => toast({ body: t("deleted") }),
                        onError: (error) => toast({ body: error.message, type: "error" }),
                    });
                    setDeleting(null);
                }}
                width={360}
            />
        </PageBody>
    );
}

const ANY_DOMAIN = "";

function CreateKeyDialog({
    open,
    onClose,
    onCreated,
}: {
    open: boolean;
    onClose: () => void;
    onCreated: (result: { apiKey: ApiKey; key: string }) => void;
}) {
    const t = useTranslations("api_keys");
    const ta = useTranslations("alias_create");
    const toast = useToast();
    const { isOnline } = useOnlineStatus();
    const { domains, destinations } = useMailflare();
    const { createApiKey } = useApiKeys();
    const confirmed = (destinations.data ?? []).filter((d) => d.verified);

    const [name, setName] = useState("Bitwarden");
    const [destination, setDestination] = useState("");
    const [domain, setDomain] = useState(ANY_DOMAIN);
    const [keyFormat, setKeyFormat] = useState<KeyFormat>(defaultFormat);
    const chosenDestination = destination || confirmed[0]?.email || "";

    const change = (changes: Partial<KeyFormat>) =>
        setKeyFormat((current) => {
            const next = { ...current, ...changes };
            // Named after the website: there has to be a website part.
            if (next.format === "domain" && next.prefixFormat === "none") {
                next.prefixFormat = "domainWithoutExtension";
            }
            return next;
        });

    function submit(event: FormEvent) {
        event.preventDefault();
        createApiKey.mutate(
            {
                name: name.trim(),
                destination: chosenDestination,
                domain: domain || null,
                format: keyFormat,
            },
            {
                onSuccess: (result) => {
                    setName("Bitwarden");
                    onCreated(result);
                },
                onError: (error) => toast({ body: error.message, type: "error" }),
            },
        );
    }

    const handleOpenChange = (isOpen: boolean) => !isOpen && onClose();
    const prefixOptions = [
        ...(keyFormat.format === "domain" ? [] : [{ value: "none", label: ta("prefix_none") }]),
        { value: "domainWithoutExtension", label: ta("prefix_domain_without_ext") },
        { value: "domainWithExtension", label: ta("prefix_domain_with_ext") },
        { value: "fullDomain", label: ta("prefix_full_domain") },
    ];

    return (
        <Dialog isOpen={open} onOpenChange={handleOpenChange} purpose="form" width={440}>
            <form onSubmit={submit} style={{ display: "contents" }}>
                <Layout
                    header={<DialogHeader title={t("create")} onOpenChange={handleOpenChange} />}
                    footer={
                        <LayoutFooter hasDivider>
                            <Button
                                type="submit"
                                variant="primary"
                                label={t("create")}
                                isLoading={createApiKey.isPending}
                                isDisabled={!isOnline || !name.trim() || !chosenDestination}
                            />
                        </LayoutFooter>
                    }
                >
                    <LayoutContent>
                        <VStack gap={3}>
                            <TextInput
                                label={t("name")}
                                description={t("name_hint")}
                                value={name}
                                onChange={setName}
                            />
                            <Selector
                                label={ta("destination")}
                                options={confirmed.map((d) => ({ value: d.email, label: d.email }))}
                                value={chosenDestination || undefined}
                                onChange={setDestination}
                                placeholder={ta("destination")}
                            />
                            <Selector
                                label={t("domain")}
                                description={t("domain_hint")}
                                options={[
                                    { value: ANY_DOMAIN, label: t("domain_any") },
                                    ...(domains.data ?? []).map((d) => ({
                                        value: d.domain,
                                        label: d.domain,
                                    })),
                                ]}
                                value={domain}
                                onChange={setDomain}
                            />
                            <Selector
                                label={ta("alias_format")}
                                options={[
                                    { value: "characters", label: ta("format_characters") },
                                    { value: "words", label: ta("format_words") },
                                    { value: "domain", label: ta("format_domain") },
                                ]}
                                value={keyFormat.format}
                                onChange={(v) => change({ format: v as KeyFormat["format"] })}
                            />
                            {keyFormat.format === "characters" && (
                                <NumberInput
                                    label={ta("number_of_chars")}
                                    value={keyFormat.characterCount}
                                    onChange={(v) => change({ characterCount: v })}
                                    min={3}
                                    max={25}
                                />
                            )}
                            {keyFormat.format === "words" && (
                                <NumberInput
                                    label={ta("number_of_words")}
                                    value={keyFormat.wordCount}
                                    onChange={(v) => change({ wordCount: v })}
                                    min={1}
                                    max={5}
                                />
                            )}
                            <Selector
                                label={ta("prefix")}
                                description={t("prefix_hint")}
                                options={prefixOptions}
                                value={keyFormat.prefixFormat}
                                onChange={(v) =>
                                    change({ prefixFormat: v as KeyFormat["prefixFormat"] })
                                }
                            />
                        </VStack>
                    </LayoutContent>
                </Layout>
            </form>
        </Dialog>
    );
}

/** The new key, shown once, with how to set up Bitwarden. */
function CreatedKeyDialog({
    created,
    onClose,
}: {
    created: { apiKey: ApiKey; key: string } | null;
    onClose: () => void;
}) {
    const t = useTranslations("api_keys");
    const toast = useToast();
    const workerUrl = useAuthStore((s) => s.workerUrl) ?? "";
    const { domains } = useMailflare();
    const domain = created?.apiKey.domain ?? domains.data?.[0]?.domain ?? "";
    const handleOpenChange = (isOpen: boolean) => !isOpen && onClose();

    async function copy(text: string) {
        await navigator.clipboard.writeText(text);
        toast({ body: t("copied") });
    }

    const settings: [string, string][] = [
        [t("bitwarden_service"), "addy.io"],
        [t("bitwarden_domain"), domain],
        [t("bitwarden_token"), created?.key ?? ""],
        [t("bitwarden_url"), `${workerUrl}/api/addy`],
    ];

    return (
        <Dialog isOpen={created !== null} onOpenChange={handleOpenChange} width={480}>
            <Layout
                header={<DialogHeader title={t("created_title")} onOpenChange={handleOpenChange} />}
                footer={
                    <LayoutFooter hasDivider>
                        <Button variant="primary" label={t("done")} onClick={onClose} />
                    </LayoutFooter>
                }
            >
                <LayoutContent>
                    <VStack gap={4}>
                        <Banner status="warning" title={t("created_warning")} />
                        <VStack gap={2}>
                            <Text>{t("bitwarden_steps")}</Text>
                            {settings.map(([label, value]) => (
                                <HStack key={label} gap={2} align="center">
                                    <VStack gap={0} style={{ flex: 1, minWidth: 0 }}>
                                        <Text type="supporting">{label}</Text>
                                        <Text
                                            style={{
                                                fontFamily: "ui-monospace, monospace",
                                                overflowWrap: "anywhere",
                                            }}
                                        >
                                            {value}
                                        </Text>
                                    </VStack>
                                    <IconButton
                                        label={t("copy", { what: label })}
                                        icon={<TbCopy />}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => copy(value)}
                                    />
                                </HStack>
                            ))}
                        </VStack>
                        <Text type="supporting">
                            {t("simplelogin_hint", { url: `${workerUrl}/api/simplelogin` })}
                        </Text>
                    </VStack>
                </LayoutContent>
            </Layout>
        </Dialog>
    );
}
