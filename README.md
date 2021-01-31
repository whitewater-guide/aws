This is AWS infrastructure for whitewater.guide implemented using aws-cdk

# Development

## Prerequisites

- You'll need to create various secrets and configuration parameters in AWS Secrets Manager and AWS Systems Manager Parameter Store.  
  Check out [SSM](./lib/SSM.ts) for the list of parameters.
- SSL Certificates stack has to be created separately (because there's a limit on number of certificates). Certificate arn should be copied into `bin/aws-accounts.ts`

## Postgres restore

TODO

## Starting and stopping stack

Use `yarn start` and `yarn stop` to start and stop resources created by stack without destroying and recreating the stack. This saved money and/or time during development.
