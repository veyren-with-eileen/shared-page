export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  env!: Env;
  ctx!: ExecutionContext & { props: Props };
}
