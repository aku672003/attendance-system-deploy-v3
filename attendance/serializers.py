from rest_framework import serializers
from .models import AvatarAsset, Memoji

class AvatarAssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = AvatarAsset
        fields = '__all__'

class MemojiSerializer(serializers.ModelSerializer):
    class Meta:
        model = Memoji
        fields = '__all__'
