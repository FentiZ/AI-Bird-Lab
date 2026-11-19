from io import BytesIO
from unittest.mock import patch
import unittest
from PIL import Image
from main import clean_name, predict_bytes


class ModelStub:
    def __call__(self, image, top_k):
        assert image.mode == 'RGB'
        assert top_k == 3
        return [
            {'label': 'European_Robin', 'score': 0.8},
            {'label': 'House Sparrow', 'score': 0.15},
            {'label': 'Mallard', 'score': 0.05},
        ]


class WorkerTest(unittest.TestCase):
    def test_classification_without_downloading_model(self):
        img = Image.new('RGB', (20, 20), 'red')
        data = BytesIO()
        img.save(data, format='JPEG')
        with patch('main.get_bird_detector', return_value=lambda photo, candidate_labels: [
                {'label': 'a bird', 'score': 0.88}] ), patch('main.get_classifier', return_value=ModelStub()):
            result = predict_bytes(data.getvalue())
        self.assertEqual(result['predictedSpecies'], 'European Robin')
        self.assertEqual(len(result['top3']), 3)
        self.assertEqual(result['confidence'], 80.0)

    def test_bad_image(self):
        with self.assertRaises(ValueError):
            predict_bytes(b'not an image')

    def test_clean_name(self):
        self.assertEqual(clean_name('12._Barn_Owl'), 'Barn Owl')


if __name__ == '__main__':
    unittest.main()
