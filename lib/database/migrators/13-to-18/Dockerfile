FROM ghcr.io/whitewater-guide/pg_dump_restore:4.0.1

WORKDIR /app

COPY migrate.sh ./

ENTRYPOINT [ "/app/migrate.sh" ]
