import * as vscode from 'vscode';

declare module 'vscode.git' {
  export interface GitExtension {
    readonly enabled: boolean;
    readonly onDidChangeEnablement: vscode.Event<boolean>;
    getAPI(version: 1): API;
  }

  export interface API {
    readonly repositories: readonly Repository[];
    readonly onDidOpenRepository: vscode.Event<Repository>;
    readonly onDidRunOperation?: vscode.Event<RepositoryOperationEvent & { readonly repository: Repository }>;
  }

  export interface Repository {
    readonly rootUri: vscode.Uri;
    readonly onDidRunOperation?: vscode.Event<RepositoryOperationEvent>;
    log(options?: LogOptions): Promise<Commit[]>;
  }

  export interface RepositoryOperationEvent {
    readonly operation: Operation;
    readonly hasErrored: boolean;
  }

  export interface Commit {
    readonly hash: string;
    readonly message: string;
  }

  export interface LogOptions {
    readonly maxEntries?: number;
  }

  export const enum Operation {
    Status,
    Add,
    Revert,
    Commit,
    Clean,
    Branch,
    Checkout,
    Reset,
    Fetch,
    Pull,
    Push,
    Sync,
    Show,
    Stage,
    Apply,
    CherryPick,
    Remote,
    Merge,
    Rebase,
    Ignore,
    Stash,
    Tag,
    CommitWithInput,
    RevertFiles,
    Switch,
    CheckoutTag
  }
}
