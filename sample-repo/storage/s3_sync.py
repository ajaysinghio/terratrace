import boto3

from .models import PendingUpload

s3 = boto3.client("s3")


def sync_pending_uploads(bucket: str) -> list[str]:
    """Fetch each pending upload's object metadata one at a time.

    Planted chatty-s3-loop: this issues a separate S3 API call per row
    instead of paginating/batching. TerraTrace should flag the `for` loop
    below.
    """
    pending = PendingUpload.objects.filter(synced=False)
    synced_keys = []

    pending_keys = {upload.key for upload in pending}

    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            if obj["Key"] in pending_keys and obj["Size"] > 0:
                synced_keys.append(obj["Key"])

    return synced_keys
