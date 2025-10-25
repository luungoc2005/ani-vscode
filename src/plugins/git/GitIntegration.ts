import * as vscode from 'vscode';
import * as path from 'path';
import type { API as GitAPI, GitExtension, Repository, RepositoryOperationEvent } from 'vscode.git';
import { AgentLoop } from '../../AgentLoop';
import { CodeReviewPlugin } from '../CodeReviewPlugin';

const OPERATION_PUSH = 10; // Mirrors vscode.git Operation.Push const enum value

type OperationEventWithRepository = RepositoryOperationEvent & { readonly repository?: Repository };

interface RepositoryTracker {
  lastAhead?: number;
  lastHandledCommit?: string;
  isHandlingPush?: boolean;
}

const repositoryTrackers = new WeakMap<Repository, RepositoryTracker>();

function getRepositoryTracker(repository: Repository): RepositoryTracker {
  let tracker = repositoryTrackers.get(repository);
  if (!tracker) {
    tracker = {};
    repositoryTrackers.set(repository, tracker);
  }
  return tracker;
}

function initializeRepositoryTracker(repository: Repository): void {
  const tracker = getRepositoryTracker(repository);
  const head = repository.state?.HEAD;
  const ahead = typeof head?.ahead === 'number' ? head.ahead : undefined;
  tracker.lastAhead = ahead;

  if (tracker.lastHandledCommit === undefined && ahead === 0 && head?.commit) {
    tracker.lastHandledCommit = head.commit;
  }
}

function schedulePushCompliment(
  repository: Repository,
  codeReviewPlugin: CodeReviewPlugin,
  agentLoop: AgentLoop
): void {
  const tracker = getRepositoryTracker(repository);
  if (tracker.isHandlingPush) {
    return;
  }

  tracker.isHandlingPush = true;
  void handlePush(repository, codeReviewPlugin, agentLoop)
    .catch((err) => {
      console.error('[ani-vscode] Failed to process push compliment workflow', err);
    })
    .finally(() => {
      tracker.isHandlingPush = false;
    });
}

function handleRepositoryStateChange(
  repository: Repository,
  codeReviewPlugin: CodeReviewPlugin,
  agentLoop: AgentLoop
): void {
  const tracker = getRepositoryTracker(repository);
  const head = repository.state?.HEAD;

  const ahead = typeof head?.ahead === 'number' ? head.ahead : undefined;
  const commit = head?.commit;
  const previousAhead = typeof tracker.lastAhead === 'number' ? tracker.lastAhead : undefined;

  tracker.lastAhead = ahead;

  if (!head || typeof previousAhead !== 'number' || typeof ahead !== 'number') {
    return;
  }

  const transitionedToSynced = previousAhead > 0 && ahead === 0;
  if (!transitionedToSynced || !commit) {
    return;
  }

  if (tracker.lastHandledCommit === commit) {
    return;
  }

  schedulePushCompliment(repository, codeReviewPlugin, agentLoop);
}

async function getGitApi(): Promise<GitAPI | null> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) {
    return null;
  }

  if (!extension.isActive) {
    try {
      await extension.activate();
    } catch (err) {
      console.error('[ani-vscode] Failed to activate Git extension', err);
      return null;
    }
  }

  try {
    return extension.exports.getAPI(1);
  } catch (err) {
    console.error('[ani-vscode] Failed to obtain Git API v1', err);
    return null;
  }
}

async function handlePush(
  repository: Repository,
  codeReviewPlugin: CodeReviewPlugin,
  agentLoop: AgentLoop
): Promise<void> {
  const tracker = getRepositoryTracker(repository);
  try {
    const commits = await repository.log({ maxEntries: 1 });
    const lastCommit = commits?.[0];
    const lastCommitMessage = lastCommit?.message?.trim();
    if (!lastCommitMessage) {
      return;
    }

    if (lastCommit?.hash) {
      tracker.lastHandledCommit = lastCommit.hash;
    }

    const headAhead = repository.state?.HEAD?.ahead;
    if (typeof headAhead === 'number') {
      tracker.lastAhead = headAhead;
    }

    const repoName = path.basename(repository.rootUri.fsPath);
    const prompt = codeReviewPlugin.createCommitComplimentPrompt({
      commitMessage: lastCommitMessage,
      repositoryName: repoName
    });

    agentLoop.enqueueUserMessage(prompt, { priority: true });
    agentLoop.trigger('codeReview');
  } catch (err) {
    console.error('[ani-vscode] Failed to read commit history for push event', err);
  }
}

function subscribeToPushEvents(
  repository: Repository,
  gitApi: GitAPI | null,
  listener: (event: OperationEventWithRepository) => void
): vscode.Disposable | null {
  const repoEvent = repository.onDidRunOperation;
  if (typeof repoEvent === 'function') {
    return repoEvent(listener);
  }

  const apiEvent = gitApi?.onDidRunOperation;
  if (typeof apiEvent === 'function') {
    return apiEvent((event: OperationEventWithRepository) => {
      if (!event.repository || event.repository === repository) {
        listener(event);
      }
    });
  }

  return null;
}

function watchRepository(
  repository: Repository,
  gitApi: GitAPI | null,
  disposables: vscode.Disposable[],
  codeReviewPlugin: CodeReviewPlugin,
  agentLoop: AgentLoop
): void {
  initializeRepositoryTracker(repository);

  const disposable = subscribeToPushEvents(repository, gitApi, (event: OperationEventWithRepository) => {
    if (event.operation === OPERATION_PUSH && !event.hasErrored) {
      schedulePushCompliment(repository, codeReviewPlugin, agentLoop);
    }
  });

  if (disposable) {
    disposables.push(disposable);
  } else {
    console.warn(
      '[ani-vscode] Git repository does not expose onDidRunOperation; push compliment notifications disabled for',
      repository.rootUri.toString()
    );
  }

  const stateEvent = repository.state?.onDidChange;
  if (typeof stateEvent === 'function') {
    const stateDisposable = stateEvent(() => {
      handleRepositoryStateChange(repository, codeReviewPlugin, agentLoop);
    });
    disposables.push(stateDisposable);
  } else if (repository.state) {
    console.warn(
      '[ani-vscode] Git repository state does not expose onDidChange; CLI push detection disabled for',
      repository.rootUri.toString()
    );
  }
}

export async function registerGitPushListener(
  codeReviewPlugin: CodeReviewPlugin,
  agentLoop: AgentLoop
): Promise<vscode.Disposable | null> {
  const gitApi = await getGitApi();
  if (!gitApi) {
    return null;
  }

  const disposables: vscode.Disposable[] = [];

  gitApi.repositories.forEach((repo: Repository) => {
    watchRepository(repo, gitApi, disposables, codeReviewPlugin, agentLoop);
  });

  const openRepoDisposable = gitApi.onDidOpenRepository((repo: Repository) => {
    watchRepository(repo, gitApi, disposables, codeReviewPlugin, agentLoop);
  });
  disposables.push(openRepoDisposable);

  return vscode.Disposable.from(...disposables);
}
