-- Until now every account could do everything: nobody loses that by updating. New accounts are members.
UPDATE `user` SET role = 'admin';
