import * as vscode from 'vscode';
import * as path from 'path';
import type { API as GitAPI, GitExtension, Repository, RepositoryOperationEvent } from 'vscode.git';
import { AgentLoop } from '../../AgentLoop';
import { CodeReviewPlugin } from '../CodeReviewPlugin';

const OPERATION_PUSH = 10; // Mirrors vscode.git Operation.Push const enum value

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
  try {
    const commits = await repository.log({ maxEntries: 1 });
    const lastCommitMessage = commits?.[0]?.message?.trim();
    if (!lastCommitMessage) {
      return;
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

type OperationEventWithRepository = RepositoryOperationEvent & { readonly repository?: Repository };

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
  const disposable = subscribeToPushEvents(repository, gitApi, (event: OperationEventWithRepository) => {
    if (event.operation === OPERATION_PUSH && !event.hasErrored) {
      void handlePush(repository, codeReviewPlugin, agentLoop);
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
