# -*- coding: utf-8 -*-
"""Exclusive, flushed JSON publication shared by native diagnostic scripts."""
import json
import os


def publish_json(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2).encode('utf-8'))
        stream.flush()
        os.fsync(stream.fileno())
