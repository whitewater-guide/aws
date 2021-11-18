export interface AppConfig {
  isDev?: boolean;
  topLevelDomain: string;
  wildcardCertArn: string;
  imgproxySecretValue: string;
  /**
   * Options for syncicng dev deployment with prod deployment
   */
  crossAccount?: {
    devBackupTaskRoleArn?: string;
    prodBackupsBucketName?: string;
  };
}
