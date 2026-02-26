import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderName, PushResult } from '../src/types.js';
import { type DeleteLoadResult, DeleteWizard } from '../src/ui/DeleteWizard.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const tick = () => new Promise<void>((r) => setTimeout(r, 30));

async function waitFor(fn: () => void, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      fn();
      await tick();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  fn(); // Final call — will throw if still failing
}

// ── Test data ─────────────────────────────────────────────────────────────

const mockLoadResult: DeleteLoadResult = {
  targets: [
    {
      provider: 'github',
      target: 'actions',
      displayName: 'GitHub Actions',
      keyCount: 3,
    },
    {
      provider: 'github',
      target: 'codespaces',
      displayName: 'GitHub Codespaces',
      keyCount: 2,
    },
  ],
  remoteKeysByTarget: {
    'github:actions': ['API_KEY', 'DB_URL', 'STRIPE_KEY'],
    'github:codespaces': ['API_KEY', 'DB_URL'],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('DeleteWizard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    const loadData = vi.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    const { lastFrame, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    const frame = lastFrame();
    expect(frame).toContain('envguard');
    expect(frame).toContain('delete secrets');
    expect(frame).toContain('Loading...');
    unmount();
  });

  it('shows target selection after loading', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Select target:');
      expect(frame).toContain('GitHub Actions');
      expect(frame).toContain('GitHub Codespaces');
      expect(frame).toContain('3 secrets');
      expect(frame).toContain('2 secrets');
    });

    unmount();
  });

  it('shows loading summary after load', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('5 remote secrets across 2 targets');
    });

    unmount();
  });

  it('navigates to secret selection on enter from target', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, stdin, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select target:');
    });

    stdin.write('\r'); // Enter — selects first target (GitHub Actions)

    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to delete:');
      expect(lastFrame()).toContain('API_KEY');
      expect(lastFrame()).toContain('DB_URL');
      expect(lastFrame()).toContain('STRIPE_KEY');
      expect(lastFrame()).toContain('Deleting from: GitHub Actions');
    });

    unmount();
  });

  it('navigates to second target with arrow down', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, stdin, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select target:');
    });

    stdin.write('\u001B[B'); // Arrow down
    await tick();
    stdin.write('\r'); // Enter — selects second target (GitHub Codespaces)

    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to delete:');
      expect(lastFrame()).toContain('Deleting from: GitHub Codespaces');
      // Codespaces has 2 keys: API_KEY, DB_URL
      expect(lastFrame()).toContain('API_KEY');
      expect(lastFrame()).toContain('DB_URL');
    });

    unmount();
  });

  it('navigates to confirm from secret selection', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, stdin, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select target:');
    });

    stdin.write('\r'); // → select secrets

    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to delete:');
    });

    stdin.write('\r'); // → confirm (all pre-selected)

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('permanently delete');
      expect(frame).toContain('cannot be undone');
      expect(frame).toContain('Press Enter to delete');
    });

    unmount();
  });

  it('shows red warning in confirm step', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, stdin, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select target:');
    });

    stdin.write('\r'); // → select secrets

    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to delete:');
    });

    stdin.write('\r'); // → confirm

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('3 secrets from GitHub Actions');
      expect(frame).toContain('API_KEY');
      expect(frame).toContain('DB_URL');
      expect(frame).toContain('STRIPE_KEY');
    });

    unmount();
  });

  it('goes back to target selection from secrets on escape', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, stdin, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select target:');
    });

    stdin.write('\r'); // → select secrets

    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to delete:');
    });

    stdin.write('\u001B'); // Escape → back to target select

    await waitFor(() => {
      expect(lastFrame()).toContain('Select target:');
    });

    unmount();
  });

  it('goes back to secrets from confirm on escape', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, stdin, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select target:');
    });

    stdin.write('\r'); // → select secrets
    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to delete:');
    });

    stdin.write('\r'); // → confirm
    await waitFor(() => {
      expect(lastFrame()).toContain('permanently delete');
    });

    stdin.write('\u001B'); // Escape → back to secrets
    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to delete:');
    });

    unmount();
  });

  it('completes delete flow and shows done', async () => {
    const deleteFn = vi.fn().mockResolvedValue([
      {
        key: 'API_KEY',
        provider: 'github',
        target: 'actions',
        status: 'ok',
      },
    ]);
    const onExit = vi.fn();
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);

    const { lastFrame, stdin, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={deleteFn} onExit={onExit} />,
    );

    // target → secrets → confirm → delete
    await waitFor(() => {
      expect(lastFrame()).toContain('Select target:');
    });
    stdin.write('\r');

    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to delete:');
    });
    stdin.write('\r');

    await waitFor(() => {
      expect(lastFrame()).toContain('Press Enter to delete');
    });
    stdin.write('\r');

    await waitFor(() => {
      expect(lastFrame()).toContain('deleted');
    });

    unmount();
  });

  it('handles load error gracefully', async () => {
    const loadData = vi.fn().mockRejectedValue(new Error('Network failure'));

    const { lastFrame, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Network failure');
    });

    unmount();
  });

  it('shows error state when no remote secrets exist', async () => {
    const emptyResult: DeleteLoadResult = {
      targets: [
        {
          provider: 'github',
          target: 'actions',
          displayName: 'GitHub Actions',
          keyCount: 0,
        },
      ],
      remoteKeysByTarget: {
        'github:actions': [],
      },
    };
    const loadData = vi.fn().mockResolvedValue(emptyResult);

    const { lastFrame, unmount } = render(
      <DeleteWizard loadData={loadData} deleteFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('No remote secrets found');
    });

    unmount();
  });
});
