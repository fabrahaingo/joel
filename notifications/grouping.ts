import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { dateToFrenchString, JORFtoDate } from "../utils/date.utils.ts";
import { getJORFTextLink } from "../utils/JORFSearch.utils.ts";

export type GroupIdentifier = string | string[] | null | undefined;

export interface NotificationGroupingConfig {
  getGroupId: (record: JORFSearchItem) => GroupIdentifier;
  fallbackLabel?: string;
  formatGroupTitle?: (options: {
    groupId: string;
    markdownLinkEnabled: boolean;
    records: JORFSearchItem[];
  }) => string;
  sortGroupIds?: (
    groupIds: string[],
    groupedMap: Map<string, JORFSearchItem[]>
  ) => string[];
  omitOrganisationNames?: boolean;
  subGrouping?: NotificationGroupingConfig;
}

export type LeafFormatter = (
  records: JORFSearchItem[],
  markdownLinkEnabled: boolean,
  config: NotificationGroupingConfig
) => string;

export type SeparatorSelector = (level: number) => string;

function normaliseGroupId(id: string | null | undefined): string | null {
  if (id === undefined || id === null) return null;
  const trimmed = String(id).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function groupRecordsBy(
  records: JORFSearchItem[],
  config: NotificationGroupingConfig
): Map<string, JORFSearchItem[]> {
  const grouped = new Map<string, JORFSearchItem[]>();

  for (const record of records) {
    const rawGroupId = config.getGroupId(record);
    const candidateIds = Array.isArray(rawGroupId) ? rawGroupId : [rawGroupId];

    const validIds = candidateIds
      .map((value) => normaliseGroupId(value))
      .filter((value): value is string => value !== null);

    const fallbackKey = normaliseGroupId(config.fallbackLabel);
    const keysToUse =
      validIds.length > 0 ? validIds : fallbackKey ? [fallbackKey] : [];

    for (const key of keysToUse) {
      const existing = grouped.get(key) ?? [];
      existing.push(record);
      grouped.set(key, existing);
    }
  }

  return grouped;
}

export function orderGroupedEntries(
  groupedMap: Map<string, JORFSearchItem[]>,
  sort?: (
    groupIds: string[],
    groupedMap: Map<string, JORFSearchItem[]>
  ) => string[]
): [string, JORFSearchItem[]][] {
  const groupIds = sort
    ? sort([...groupedMap.keys()], groupedMap)
    : [...groupedMap.keys()];
  return groupIds.map((groupId) => [groupId, groupedMap.get(groupId) ?? []]);
}

export function formatGroupedRecords(
  groupedMap: Map<string, JORFSearchItem[]>,
  config: NotificationGroupingConfig,
  markdownLinkEnabled: boolean,
  leafFormatter: LeafFormatter,
  separatorSelector: SeparatorSelector,
  level = 0
): string {
  const orderedEntries = orderGroupedEntries(
    groupedMap,
    config.sortGroupIds
  ).filter(([, records]) => records.length > 0);

  if (orderedEntries.length === 0) return "";

  return orderedEntries
    .map(([groupId, groupRecords], index) => {
      const title =
        config.formatGroupTitle?.({
          groupId,
          markdownLinkEnabled,
          records: groupRecords
        }) ?? `👉 ${groupId}\n\n`;

      const content = config.subGrouping
        ? formatGroupedRecords(
            groupRecordsBy(groupRecords, config.subGrouping),
            config.subGrouping,
            markdownLinkEnabled,
            leafFormatter,
            separatorSelector,
            level + 1
          )
        : leafFormatter(groupRecords, markdownLinkEnabled, config);

      const isLast = index === orderedEntries.length - 1;
      const separator = !isLast ? separatorSelector(level) : "";

      return `${title}${content}${separator}`;
    })
    .join("");
}

export function createFieldGrouping(
  accessor: (record: JORFSearchItem) => GroupIdentifier,
  options?: Omit<NotificationGroupingConfig, "getGroupId">
): NotificationGroupingConfig {
  return {
    getGroupId: accessor,
    fallbackLabel: options?.fallbackLabel,
    formatGroupTitle: options?.formatGroupTitle,
    sortGroupIds: options?.sortGroupIds,
    omitOrganisationNames: options?.omitOrganisationNames,
    subGrouping: options?.subGrouping
  };
}

function getGroupDate(records: JORFSearchItem[]): Date | null {
  if (!records.length) return null;
  const date = records[0]?.source_date;
  return date ? JORFtoDate(date) : null;
}

export function createReferenceGrouping(options?: {
  formatGroupTitle?: NotificationGroupingConfig["formatGroupTitle"];
  omitOrganisationNames?: boolean;
}): NotificationGroupingConfig {
  return {
    getGroupId: (record) => record.source_id,
    formatGroupTitle: (args) => {
      if (options?.formatGroupTitle) return options.formatGroupTitle(args);

      const { groupId, markdownLinkEnabled, records } = args;
      const firstRecord = records[0];
      const dateLabel = dateToFrenchString(firstRecord.source_date);

      let label = `${firstRecord.source_name} du ${dateLabel}`;
      const refLink = getJORFTextLink(groupId);

      label += markdownLinkEnabled
        ? `: [cliquez ici](${refLink})`
        : `\n${refLink}`;

      return `📰 ${label}\n\n`;
    },
    sortGroupIds: (groupIds, groupedMap) => {
      return [...groupIds].sort((a, b) => {
        const aRecords = groupedMap.get(a) ?? [];
        const bRecords = groupedMap.get(b) ?? [];
        const aDate = getGroupDate(aRecords);
        const bDate = getGroupDate(bRecords);

        if (aDate && bDate) {
          if (aDate.getTime() !== bDate.getTime())
            return bDate.getTime() - aDate.getTime();
        } else if (aDate) {
          return -1;
        } else if (bDate) {
          return 1;
        }

        return b.localeCompare(a, "fr", { sensitivity: "base" });
      });
    },
    omitOrganisationNames: options?.omitOrganisationNames,
    subGrouping: undefined
  };
}
