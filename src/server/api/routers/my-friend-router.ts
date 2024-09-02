import type { Database } from '@/server/db'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'
import { protectedProcedure } from '@/server/trpc/procedures'
import { router } from '@/server/trpc/router'
import {
  NonEmptyStringSchema,
  CountSchema,
  IdSchema,
} from '@/utils/server/base-schemas'

export const myFriendRouter = router({
  getById: protectedProcedure
    .input(
      z.object({
        friendUserId: IdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      /**
       * Question 4: Implement mutual friend count
       *
       * Add `mutualFriendCount` to the returned result of this query. You can
       * either:
       *  (1) Make a separate query to count the number of mutual friends,
       *  then combine the result with the result of this query
       *  (2) BONUS: Use a subquery (hint: take a look at how
       *  `totalFriendCount` is implemented)
       *
       * Instructions:
       *  - Go to src/server/tests/friendship-request.test.ts, enable the test
       * scenario for Question 4
       *  - Run `yarn test` to verify your answer
       *
       * Documentation references:
       *  - https://kysely-org.github.io/kysely/classes/SelectQueryBuilder.html#innerJoin
       */
      const userId = ctx.session.userId
      const friendUserId = input.friendUserId

      return ctx.db.connection().execute(async (conn) => {
        // Subquery to count mutual friends
        const mutualFriendCountSubquery = conn
          .selectFrom('friendships as f1')
          .innerJoin('friendships as f2', 'f1.friendUserId', 'f2.friendUserId')
          .where('f1.userId', '=', userId)
          .where('f2.userId', '=', friendUserId)
          .where('f1.status', '=', FriendshipStatusSchema.Values['accepted'])
          .where('f2.status', '=', FriendshipStatusSchema.Values['accepted'])
          .select((eb) => [
            eb.fn.count('f1.friendUserId').as('mutualFriendCount'),
          ])
          .groupBy('f1.userId')
          .as('mutualFriendCountSubquery')

        // Main query
        const result = await conn
          .selectFrom('users as friends')
          .innerJoin('friendships', 'friendships.friendUserId', 'friends.id')
          .where('friendships.userId', '=', userId)
          .where('friendships.friendUserId', '=', friendUserId)
          .where(
            'friendships.status',
            '=',
            FriendshipStatusSchema.Values['accepted']
          )
          .select([
            'friends.id',
            'friends.fullName',
            'friends.phoneNumber',
            (subquery) =>
              subquery
                .selectFrom(mutualFriendCountSubquery)
                .select('mutualFriendCount')
                .as('mutualFriendCount'),
          ])
          .executeTakeFirstOrThrow(() => new TRPCError({ code: 'NOT_FOUND' }))
          .then(
            z.object({
              id: IdSchema,
              fullName: NonEmptyStringSchema,
              phoneNumber: NonEmptyStringSchema,
              totalFriendCount: CountSchema,
              mutualFriendCount: CountSchema,
            }).parse
          )

        return result
      })
    }),
})

const userTotalFriendCount = (db: Database) => {
  return db
    .selectFrom('friendships')
    .where('friendships.status', '=', FriendshipStatusSchema.Values['accepted'])
    .select((eb) => [
      'friendships.userId',
      eb.fn.count('friendships.friendUserId').as('totalFriendCount'),
    ])
    .groupBy('friendships.userId')
}
