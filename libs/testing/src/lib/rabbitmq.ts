import {
  RabbitMQContainer,
  type StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';
import { RABBITMQ_IMAGE, STARTUP_TIMEOUT_MS } from './images';

export interface TestRabbitMq {
  container: StartedRabbitMQContainer;
  url: string;
  stop(): Promise<void>;
}

export async function startRabbitMq(): Promise<TestRabbitMq> {
  const container = await new RabbitMQContainer(RABBITMQ_IMAGE)
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
  return {
    container,
    url: container.getAmqpUrl(),
    stop: async () => {
      await container.stop();
    },
  };
}
