/**
 * Queue for storing user messages
 */
export class MessageQueue {
  private queue: string[] = [];

  /**
   * Add a message to the queue
   */
  enqueue(message: string): void {
    this.queue.push(message);
  }

  /**
   * Remove and return the next message from the queue
   */
  dequeue(): string | null {
    if (this.queue.length === 0) {
      return null;
    }
    return this.queue.shift() || null;
  }

  /**
   * Check if the queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get the number of messages in the queue
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear all messages from the queue
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Peek at the next message without removing it
   */
  peek(): string | null {
    if (this.queue.length === 0) {
      return null;
    }
    return this.queue[0];
  }
}
