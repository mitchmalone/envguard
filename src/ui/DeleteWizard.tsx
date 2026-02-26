import { Box, Static, Text, useApp, useInput } from 'ink';
import { useEffect, useState } from 'react';
import type { ProviderName, PushResult } from '../types.js';
import { Banner } from './components/Banner.js';
import { type SelectItem, SelectList } from './components/SelectList.js';
import { Spinner } from './components/Spinner.js';

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 'loading' | 'select-target' | 'select-secrets' | 'confirm' | 'deleting' | 'done';

interface TargetInfo {
  provider: ProviderName;
  target: string;
  displayName: string;
  keyCount: number;
}

export interface DeleteLoadResult {
  targets: TargetInfo[];
  remoteKeysByTarget: Record<string, string[]>;
}

export interface DeleteWizardProps {
  loadData: () => Promise<DeleteLoadResult>;
  deleteFn: (keys: string[], provider: ProviderName, target: string) => Promise<PushResult[]>;
  onExit: (code: number) => void;
  verbose?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTarget(provider: ProviderName, target: string): string {
  if (provider === 'github') {
    return `GitHub ${target.charAt(0).toUpperCase()}${target.slice(1)}`;
  }
  const names: Record<ProviderName, string> = {
    github: 'GitHub',
    vercel: 'Vercel',
    netlify: 'Netlify',
  };
  return `${names[provider] ?? provider} (${target})`;
}

interface DeleteRowResult {
  key: string;
  displayName: string;
  status: 'ok' | 'error';
  error?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function DeleteWizard({ loadData, deleteFn, onExit }: DeleteWizardProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);

  // Load results
  const [loadResult, setLoadResult] = useState<DeleteLoadResult | null>(null);

  // Target selection (single select with cursor)
  const [targetCursor, setTargetCursor] = useState(0);
  const [selectedTarget, setSelectedTarget] = useState<TargetInfo | null>(null);

  // Secret selection
  const [secretItems, setSecretItems] = useState<SelectItem[]>([]);
  const [secretCursor, setSecretCursor] = useState(0);

  // Delete progress
  const [completedRows, setCompletedRows] = useState<DeleteRowResult[]>([]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [summaryCode, setSummaryCode] = useState(0);

  // ── Loading ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 'loading') return;

    loadData()
      .then((result) => {
        setLoadResult(result);

        // Filter out targets with no remote keys
        const nonEmpty = result.targets.filter((t) => t.keyCount > 0);
        if (nonEmpty.length === 0) {
          setError('No remote secrets found.');
          setSummaryCode(2);
          setStep('done');
          return;
        }

        setStep('select-target');
        setTargetCursor(0);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setSummaryCode(2);
        setStep('done');
      });
  }, [step, loadData]);

  // ── Deleting ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 'deleting') return;
    if (!selectedTarget) return;

    const selectedKeys = secretItems.filter((i) => i.selected).map((i) => i.value);

    const doDelete = async () => {
      const rows: DeleteRowResult[] = [];
      let hasErrors = false;

      for (const key of selectedKeys) {
        setCurrentKey(key);
        try {
          const results = await deleteFn([key], selectedTarget.provider, selectedTarget.target);
          const result = results[0];
          rows.push({
            key,
            displayName: selectedTarget.displayName,
            status: result?.status ?? 'error',
            error: result?.error,
          });
          if (result?.status === 'error') hasErrors = true;
        } catch (err) {
          rows.push({
            key,
            displayName: selectedTarget.displayName,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
          hasErrors = true;
        }
        setCompletedRows([...rows]);
      }

      setCurrentKey(null);
      setSummaryCode(hasErrors ? 1 : 0);
      setStep('done');
    };

    doDelete().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setSummaryCode(2);
      setStep('done');
    });
  }, [step, selectedTarget, secretItems, deleteFn]);

  // ── Target selection keyboard ────────────────────────────────────────────

  useInput(
    (_input, key) => {
      if (!loadResult) return;
      const nonEmpty = loadResult.targets.filter((t) => t.keyCount > 0);

      if (key.upArrow) {
        setTargetCursor(targetCursor > 0 ? targetCursor - 1 : nonEmpty.length - 1);
      } else if (key.downArrow) {
        setTargetCursor(targetCursor < nonEmpty.length - 1 ? targetCursor + 1 : 0);
      } else if (key.return) {
        const target = nonEmpty[targetCursor];
        setSelectedTarget(target);

        const targetKey = `${target.provider}:${target.target}`;
        const remoteKeys = loadResult.remoteKeysByTarget[targetKey] ?? [];
        const items: SelectItem[] = remoteKeys.map((k) => ({
          label: k,
          value: k,
          selected: true,
        }));
        setSecretItems(items);
        setSecretCursor(0);
        setStep('select-secrets');
      }
    },
    { isActive: step === 'select-target' },
  );

  // ── Confirm / Done keyboard ──────────────────────────────────────────────

  useInput(
    (input, key) => {
      if (step === 'confirm') {
        if (key.return) {
          setStep('deleting');
        } else if (key.escape) {
          setStep('select-secrets');
          setSecretCursor(0);
        }
      } else if (step === 'done') {
        if (key.return || input === 'q') {
          onExit(summaryCode);
          exit();
        }
      }
    },
    { isActive: step === 'confirm' || step === 'done' },
  );

  // ── Secret selection handlers ────────────────────────────────────────────

  const handleSecretToggle = (index: number) => {
    setSecretItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)),
    );
  };

  const handleSecretToggleAll = () => {
    const allSelected = secretItems.every((i) => i.selected);
    setSecretItems((prev) => prev.map((item) => ({ ...item, selected: !allSelected })));
  };

  const handleSecretSubmit = () => {
    const hasSelected = secretItems.some((i) => i.selected);
    if (hasSelected) {
      setStep('confirm');
    }
  };

  const handleSecretBack = () => {
    setStep('select-target');
    setTargetCursor(0);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text> </Text>
      <Banner subtitle="delete secrets" />
      <Text> </Text>

      {step === 'loading' && <Spinner label="Loading..." />}

      {step !== 'loading' && loadResult && <LoadingSummary targets={loadResult.targets} />}

      {step === 'select-target' && loadResult && (
        <TargetSelector
          targets={loadResult.targets.filter((t) => t.keyCount > 0)}
          cursor={targetCursor}
        />
      )}

      {step === 'select-secrets' && selectedTarget && (
        <Box flexDirection="column">
          <Text> </Text>
          <Text dimColor>{`Deleting from: ${selectedTarget.displayName}`}</Text>
          <Text> </Text>
          <SelectList
            items={secretItems}
            cursor={secretCursor}
            onToggle={handleSecretToggle}
            onToggleAll={handleSecretToggleAll}
            onCursorChange={setSecretCursor}
            onSubmit={handleSecretSubmit}
            onBack={handleSecretBack}
            title="Select secrets to delete:"
          />
        </Box>
      )}

      {step === 'confirm' && selectedTarget && (
        <ConfirmView secretItems={secretItems} targetDisplayName={selectedTarget.displayName} />
      )}

      {step === 'deleting' && (
        <DeletingView completedRows={completedRows} currentKey={currentKey} />
      )}

      {step === 'done' && (
        <DoneView completedRows={completedRows} error={error} summaryCode={summaryCode} />
      )}
    </Box>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function LoadingSummary({ targets }: { targets: TargetInfo[] }) {
  const totalKeys = targets.reduce((sum, t) => sum + t.keyCount, 0);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green">{'✓'}</Text>
        {` ${totalKeys} remote secret${totalKeys !== 1 ? 's' : ''} across ${targets.length} target${targets.length !== 1 ? 's' : ''}`}
      </Text>
    </Box>
  );
}

function TargetSelector({
  targets,
  cursor,
}: {
  targets: TargetInfo[];
  cursor: number;
}) {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        {'Select target: '}
        <Text dimColor>{'(↑/↓ to move, enter to select)'}</Text>
      </Text>
      {targets.map((t, i) => {
        const pointer = i === cursor ? '❯ ' : '  ';
        return (
          <Text key={`${t.provider}:${t.target}`}>
            {pointer}
            {t.displayName}
            <Text dimColor>{` (${t.keyCount} secret${t.keyCount !== 1 ? 's' : ''})`}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function ConfirmView({
  secretItems,
  targetDisplayName,
}: {
  secretItems: SelectItem[];
  targetDisplayName: string;
}) {
  const selected = secretItems.filter((i) => i.selected);

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text color="red" bold>
        {`⚠ This will permanently delete ${selected.length} secret${selected.length !== 1 ? 's' : ''} from ${targetDisplayName}. This cannot be undone.`}
      </Text>
      <Text> </Text>
      {selected.map((s) => (
        <Text key={s.value}>{`  ${s.label}`}</Text>
      ))}
      <Text> </Text>
      <Text dimColor>Press Enter to delete, Escape to go back</Text>
    </Box>
  );
}

function DeletingView({
  completedRows,
  currentKey,
}: {
  completedRows: DeleteRowResult[];
  currentKey: string | null;
}) {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Static items={completedRows}>{(row) => <DeleteRow key={row.key} row={row} />}</Static>
      {currentKey ? (
        <Text>
          <Text color="cyan">{'⠋'}</Text>
          {` ${currentKey}`}
        </Text>
      ) : null}
    </Box>
  );
}

function DeleteRow({ row }: { row: DeleteRowResult }) {
  const icon =
    row.status === 'ok' ? <Text color="green">{'✓'}</Text> : <Text color="red">{'✗'}</Text>;

  return (
    <Text>
      {icon}
      {` ${row.key} ← ${row.displayName}`}
      {row.error ? <Text color="red">{` (${row.error})`}</Text> : null}
    </Text>
  );
}

function DoneView({
  completedRows,
  error,
  summaryCode,
}: {
  completedRows: DeleteRowResult[];
  error: string | null;
  summaryCode: number;
}) {
  if (error) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text color="red">{`Error: ${error}`}</Text>
        <Text> </Text>
        <Text dimColor>Press Enter to exit</Text>
      </Box>
    );
  }

  const ok = completedRows.filter((r) => r.status === 'ok').length;
  const errors = completedRows.filter((r) => r.status === 'error').length;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      {ok > 0 && (
        <Text>
          <Text color="green">{'✓'}</Text>
          {` ${ok} secret${ok !== 1 ? 's' : ''} deleted`}
        </Text>
      )}
      {errors > 0 && (
        <Text>
          <Text color="red">{'✗'}</Text>
          {` ${errors} deletion${errors !== 1 ? 's' : ''} failed`}
        </Text>
      )}
      {completedRows.length === 0 && <Text dimColor>No secrets were deleted.</Text>}
      <Text> </Text>
      <Text dimColor>Press Enter to exit</Text>
    </Box>
  );
}
