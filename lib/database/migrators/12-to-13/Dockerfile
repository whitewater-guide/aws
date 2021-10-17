FROM ghcr.io/whitewater-guide/pg_dump_restore:3.6.1

ENV S3_PREFIX="v3/"

WORKDIR /app

COPY migrate.sh ./

ENTRYPOINT [ "/app/migrate.sh" ]
