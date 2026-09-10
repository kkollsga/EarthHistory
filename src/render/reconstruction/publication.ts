export type PublicationStage = "preview" | "settled";

export interface OwnedPrototypeResources {
  readonly byteLength: number;
  /** Dispose work that has never been submitted to the GPU. */
  disposeUnsubmitted(): void;
  /** Schedule retirement after the renderer's submitted-work fence. */
  retireAfterGpuWork(): Promise<void>;
}

export interface PrototypePublication<TResources extends OwnedPrototypeResources> {
  readonly requestId: string;
  readonly version: number;
  readonly stage: PublicationStage;
  readonly ageMa: number;
  readonly resources: TResources;
}

export interface PublicationToken {
  readonly requestId: string;
  readonly serial: number;
}

/** Owns the old-visible/new-staged resource transition for the laboratory path. */
export class AtomicPrototypePublisher<TResources extends OwnedPrototypeResources> {
  private serial = 0;
  private publicationVersion = 0;
  private latestRequestId = "";
  private visible: PrototypePublication<TResources> | null = null;
  private staged: PrototypePublication<TResources> | null = null;
  private readonly retiring = new Set<TResources>();
  private readonly failedRetirements = new Map<TResources, unknown>();

  begin(requestId: string): PublicationToken {
    if (!requestId) throw new Error("publication requestId must be non-empty");
    this.serial += 1;
    this.latestRequestId = requestId;
    if (this.staged) {
      this.staged.resources.disposeUnsubmitted();
      this.staged = null;
    }
    return { requestId, serial: this.serial };
  }

  stage(
    token: PublicationToken,
    ageMa: number,
    stage: PublicationStage,
    resources: TResources,
  ): boolean {
    if (!Number.isFinite(ageMa)) {
      resources.disposeUnsubmitted();
      throw new Error("publication ageMa must be finite");
    }
    if (!Number.isFinite(resources.byteLength) || resources.byteLength < 0) {
      resources.disposeUnsubmitted();
      throw new Error("publication resource byteLength must be finite and non-negative");
    }
    if (!this.isCurrent(token)) {
      resources.disposeUnsubmitted();
      return false;
    }
    if (this.staged) this.staged.resources.disposeUnsubmitted();
    this.staged = Object.freeze({
      requestId: token.requestId,
      version: this.publicationVersion + 1,
      stage,
      ageMa,
      resources,
    });
    return true;
  }

  commit(token: PublicationToken): PrototypePublication<TResources> | null {
    if (!this.isCurrent(token) || !this.staged) return null;
    const next = this.staged;
    this.staged = null;
    const previous = this.visible;
    this.visible = next;
    this.publicationVersion = next.version;
    if (previous) this.retire(previous.resources);
    return next;
  }

  current(): PrototypePublication<TResources> | null {
    return this.visible;
  }

  retainedBytes(): number {
    return (this.visible?.resources.byteLength ?? 0)
      + (this.staged?.resources.byteLength ?? 0)
      + [...this.retiring].reduce((sum, resources) => sum + resources.byteLength, 0);
  }

  retirementFailures(): readonly unknown[] {
    return Object.freeze([...this.failedRetirements.values()]);
  }

  dispose(): void {
    this.serial += 1;
    this.latestRequestId = "";
    this.staged?.resources.disposeUnsubmitted();
    if (this.visible) this.retire(this.visible.resources);
    this.staged = null;
    this.visible = null;
  }

  private isCurrent(token: PublicationToken): boolean {
    return token.serial === this.serial && token.requestId === this.latestRequestId;
  }

  private retire(resources: TResources): void {
    this.retiring.add(resources);
    let retirement: Promise<void>;
    try {
      retirement = resources.retireAfterGpuWork();
    } catch (error) {
      this.failedRetirements.set(resources, error);
      return;
    }
    void retirement.then(
      () => {
        this.retiring.delete(resources);
        this.failedRetirements.delete(resources);
      },
      (error: unknown) => {
        // An indeterminate device allocation remains in the byte ledger until
        // an owning device-loss policy explicitly releases the publisher.
        this.failedRetirements.set(resources, error);
      },
    );
  }
}
