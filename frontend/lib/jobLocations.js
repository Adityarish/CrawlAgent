export function getJobLocations(job) {
  if (!Array.isArray(job.locationPoints)) return [];
  return job.locationPoints
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
    .map((point) => ({
      key: `district-${point.districtCode}`,
      label: `${point.district}, ${point.state}`,
      position: [point.latitude, point.longitude],
      coordinateBasis: point.coordinateBasis,
    }));
}

export function groupJobsByLocation(jobs) {
  const groups = new Map();

  jobs.forEach((job) => {
    getJobLocations(job).forEach((location) => {
      if (!groups.has(location.key)) {
        groups.set(location.key, { ...location, jobs: [] });
      }
      const group = groups.get(location.key);
      if (!group.jobs.some((item) => item.id === job.id)) group.jobs.push(job);
    });
  });

  return [...groups.values()].sort((a, b) => b.jobs.length - a.jobs.length || a.label.localeCompare(b.label));
}
