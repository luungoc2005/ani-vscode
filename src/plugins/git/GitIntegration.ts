import * as vscode from 'vscode';
import * as path from 'path';
import { Operation } from 'vscode.git';
import type { API as GitAPI, GitExtension, Repository, RepositoryOperationEvent } from 'vscode.git';
import { AgentLoop } from '../../AgentLoop';
import { CodeReviewPlugin } from '../CodeReviewPlugin';

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

function watchRepository(
  repository: Repository,
  disposables: vscode.Disposable[],
  codeReviewPlugin: CodeReviewPlugin,
  agentLoop: AgentLoop
): void {
  const disposable = repository.onDidRunOperation((event: RepositoryOperationEvent) => {
    if (event.operation === Operation.Push && !event.hasErrored) {
      void handlePush(repository, codeReviewPlugin, agentLoop);
    }
  });
  disposables.push(disposable);
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
    watchRepository(repo, disposables, codeReviewPlugin, agentLoop);
  });

  const openRepoDisposable = gitApi.onDidOpenRepository((repo: Repository) => {
    watchRepository(repo, disposables, codeReviewPlugin, agentLoop);
  });
  disposables.push(openRepoDisposable);

  return vscode.Disposable.from(...disposables);
}
