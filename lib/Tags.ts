export default {
  Stoppable: ['wwguide:stoppable', 'true'] as [string, string],
  DesiredCount: (cnt: number): [string, string] => [
    'wwguide:desiredCount',
    cnt.toString(10),
  ],
};
