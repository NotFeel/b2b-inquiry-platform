FROM ubuntu:24.04
ARG DEBIAN_FRONTEND=noninteractive
ARG RUNNER_VERSION=2.328.0
ENV RUNNER_VERSION=$RUNNER_VERSION
ENV RUNNER_ALLOW_RUNASROOT=1
WORKDIR /runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git jq docker.io docker-compose-v2 libicu74 libssl3 zlib1g libkrb5-3 \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" -o /tmp/runner.tar.gz \
 && tar -xzf /tmp/runner.tar.gz -C /runner && rm /tmp/runner.tar.gz && ./bin/installdependencies.sh
COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
