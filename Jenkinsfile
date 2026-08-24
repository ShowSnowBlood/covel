pipeline {
  agent any

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
    timeout(time: 45, unit: 'MINUTES')
    timestamps()
  }

  triggers {
    githubPush()
    pollSCM('H/5 * * * *')
  }

  parameters {
    booleanParam(
      name: 'DEPLOY_PRODUCTION',
      defaultValue: true,
      description: 'Build and deploy the checked-out main commit to game.dstopology.com.'
    )
  }

  stages {
    stage('Checkout main') {
      steps {
        checkout scm
        script {
          env.DEPLOY_SHA = sh(
            script: 'git rev-parse HEAD',
            returnStdout: true
          ).trim()
          currentBuild.displayName = "#${env.BUILD_NUMBER} ${env.DEPLOY_SHA.take(12)}"
        }
      }
    }

    stage('Validate source') {
      steps {
        sh '''
          set -eu
          test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
          test -f docker/Dockerfile
          test -f docker/docker-compose.yml
          test -f pnpm-lock.yaml
          git diff --check HEAD^
        '''
      }
    }

    stage('Build and deploy production') {
      when {
        expression { params.DEPLOY_PRODUCTION }
      }
      steps {
        sh '''
          set -eu
          sudo -n /usr/local/sbin/deploy-covel-game-main "$WORKSPACE" "$DEPLOY_SHA"
        '''
      }
    }

    stage('Public smoke test') {
      when {
        expression { params.DEPLOY_PRODUCTION }
      }
      steps {
        sh '''
          set -eu
          curl --fail --silent --show-error --retry 10 --retry-delay 3 \
            https://game.dstopology.com/api/health \
            | grep -q '"status":"ok"'
          curl --fail --silent --show-error --retry 10 --retry-delay 3 \
            https://game.dstopology.com/api/frostfox/account \
            | grep -q '"clientId":"covel-game"'
        '''
      }
    }
  }

  post {
    always {
      deleteDir()
    }
  }
}
