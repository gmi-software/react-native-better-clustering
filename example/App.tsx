import MapView from "react-native-better-clustering";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Marker } from "react-native-maps";

const POLAND_BOUNDS = {
  minLat: 49.0,
  maxLat: 54.8,
  minLng: 14.1,
  maxLng: 24.1,
} as const;

const INITIAL_REGION = {
  latitude: 50.0647,
  longitude: 19.945,
  latitudeDelta: 0.3,
  longitudeDelta: 0.3,
};

interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
}

function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function generatePoints(count: number): MapPoint[] {
  const points: MapPoint[] = [];

  for (let i = 0; i < count; i++) {
    points.push({
      id: String(i),
      latitude: randomInRange(POLAND_BOUNDS.minLat, POLAND_BOUNDS.maxLat),
      longitude: randomInRange(POLAND_BOUNDS.minLng, POLAND_BOUNDS.maxLng),
    });
  }

  return points;
}

function getRandomLatitude(min = 48, max = 56) {
  return Math.random() * (max - min) + min;
}

function getRandomLongitude(min = 14, max = 24) {
  return Math.random() * (max - min) + min;
}

function generateRandomPoints(count: number): MapPoint[] {
  return Array.from({ length: count }, () => ({
    id: String(Math.random()),
    latitude: getRandomLatitude(),
    longitude: getRandomLongitude(),
  }));
}

export default function App() {
  const points = useMemo(() => generatePoints(2000), []);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <MapView style={styles.map} initialRegion={INITIAL_REGION}>
        {points.map((point) => (
          <Marker
            key={point.id}
            coordinate={{
              latitude: point.latitude,
              longitude: point.longitude,
            }}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
