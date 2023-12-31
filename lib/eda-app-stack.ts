import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "Images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    const imageTable = new dynamodb.Table(this, "ImageTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "fileName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Images",
    });

  
      // Integration infrastructure

      const deadLetterQue = new sqs.Queue(this, "deadLetterQueue", {
        queueName: "deadLetterQue",
        retentionPeriod: cdk.Duration.minutes(40),
    });

      const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
        receiveMessageWaitTime: cdk.Duration.seconds(10),
        deadLetterQueue: {
          queue: deadLetterQue,
          maxReceiveCount: 4
        },
       // retentionPeriod: cdk.Duration.seconds(90)
      }); 

      const newImageTopic = new sns.Topic(this, "NewImageTopic", {
        displayName: "New Image topic",
      }); 

      // Lambda functions
  
      const processImageFn = new lambdanode.NodejsFunction(
        this,
        "ProcessImageFn",
        {
          // architecture: lambda.Architecture.ARM_64,
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: `${__dirname}/../lambdas/processImage.ts`,
          timeout: cdk.Duration.seconds(15),
          memorySize: 128,
          deadLetterQueue: deadLetterQue,
          environment: {
            Table_Name: "images",
            Region: 'eu-west-1',
          },
        }
      );

      const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize: 128,
        timeout: cdk.Duration.seconds(15),
        entry: `${__dirname}/../lambdas/mailer.ts`,
      });

      const rejectionMailerFn = new lambdanode.NodejsFunction(this, "rejection-mailer-function", {
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize: 128,
        timeout: cdk.Duration.seconds(15),
        entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
      });

  
      // Event triggers
  
      imagesBucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.SnsDestination(newImageTopic)  // Changed
    );

  
      const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(10),
      });

      const rejectionMailEventSource = new events.SqsEventSource(deadLetterQue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(10),
      });

      //Subscribing lamda directly to SNS topic
      const lambdaSub = new subs.LambdaSubscription(mailerFn)
    newImageTopic.addSubscription(lambdaSub);

    newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue,
      ),
    );
 
  
      processImageFn.addEventSource(newImageEventSource);
      //mailerFn.addEventSource(newImageMailEventSource);
      rejectionMailerFn.addEventSource(rejectionMailEventSource);
  
  
      // Permissions
  
      imagesBucket.grantRead(processImageFn);
      imageTable.grantReadWriteData(processImageFn);

      mailerFn.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ses:SendEmail",
            "ses:SendRawEmail",
            "ses:SendTemplatedEmail",
          ],
          resources: ["*"],
        })
      );

      rejectionMailerFn.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ses:SendEmail",
            "ses:SendRawEmail",
            "ses:SendTemplatedEmail",
          ],
          resources: ["*"],
        })
      );
  
      // Output
      
      new cdk.CfnOutput(this, "bucketName", {
        value: imagesBucket.bucketName,
      });
    

    }
  }

