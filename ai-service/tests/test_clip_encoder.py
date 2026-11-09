import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image
from transformers import (
    CLIPConfig,
    CLIPImageProcessor,
    CLIPModel,
    CLIPProcessor,
    CLIPTextConfig,
    CLIPTokenizer,
    CLIPVisionConfig,
)

from app.clip_encoder import ClipEncoder


class ClipEncoderIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="tidy-local-clip-")
        cls.addClassCleanup(cls.temp.cleanup)
        root = Path(cls.temp.name)
        (root / "vocab.json").write_text(
            json.dumps({"<|startoftext|>": 0, "<|endoftext|>": 1, "a</w>": 2}),
            encoding="utf-8",
        )
        (root / "merges.txt").write_text("#version: 0.2\n", encoding="utf-8")
        tokenizer = CLIPTokenizer(
            vocab_file=str(root / "vocab.json"),
            merges_file=str(root / "merges.txt"), model_max_length=8,
        )
        processor = CLIPProcessor(
            tokenizer=tokenizer,
            image_processor=CLIPImageProcessor(
                size={"shortest_edge": 16}, crop_size={"height": 16, "width": 16},
            ),
        )
        text = CLIPTextConfig(
            vocab_size=3, hidden_size=16, intermediate_size=32,
            num_hidden_layers=1, num_attention_heads=2, max_position_embeddings=8,
            bos_token_id=0, eos_token_id=1, pad_token_id=1,
        )
        vision = CLIPVisionConfig(
            hidden_size=16, intermediate_size=32, num_hidden_layers=1,
            num_attention_heads=2, image_size=16, patch_size=8,
        )
        model = CLIPModel(CLIPConfig(
            text_config=text.to_dict(), vision_config=vision.to_dict(), projection_dim=8,
        ))
        model.save_pretrained(root)
        processor.save_pretrained(root)
        # Use real library APIs and a tiny local model; no network or production weights.
        with patch.dict(os.environ, {"HF_HUB_OFFLINE": "1"}), patch(
            "app.clip_encoder._pick_device", return_value="cpu"
        ):
            cls.encoder = ClipEncoder.load(str(root))

    def assert_embedding(self, result):
        self.assertEqual(result.embeddings.shape, (1, 8))
        self.assertTrue(np.isfinite(result.embeddings).all())
        np.testing.assert_allclose(np.linalg.norm(result.embeddings, axis=1), [1.0], atol=1e-5)

    def test_text_features_from_local_pretrained_model(self):
        self.assert_embedding(self.encoder.encode_text(["a"]))

    def test_image_features_from_local_pretrained_model(self):
        self.assert_embedding(self.encoder.encode_images([Image.new("RGB", (16, 16), "navy")]))

    def test_health_reports_both_inference_capabilities_without_loading_weights(self):
        from app.main import health

        result = health()
        self.assertTrue(result["ok"])
        for name in ("faces", "clip"):
            self.assertTrue(result["capabilities"][name]["available"], result)
