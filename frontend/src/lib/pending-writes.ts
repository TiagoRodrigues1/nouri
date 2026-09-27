export class PendingWrites<Input, Result> {
  private operations = new Map<string, { key: string; input: Input; request?: Promise<Result> }>();

  run(input: Input, signature: string, send: (input: Input, key: string) => Promise<Result>): Promise<{ key: string; result: Result }> {
    let operation = this.operations.get(signature);

    if (!operation) {
      operation = { key: crypto.randomUUID(), input };
      this.operations.set(signature, operation);
    }

    operation.request ??= send(operation.input, operation.key).finally(() => {
      if (operation) delete operation.request;
    });

    return operation.request.then((result) => ({ key: operation.key, result }));
  }

  complete(signature: string, key: string): void {
    if (this.operations.get(signature)?.key === key) this.operations.delete(signature);
  }
}
